/**
 * `design-history mcp` — a Model Context Protocol server over stdio.
 *
 * Lets an agent (Claude, Cursor, …) query your app's visual history:
 * list versions, pull the screenshot of any commit (as an image the agent can
 * see), and read what changed. "What did the pricing page look like before the
 * March redesign?" becomes answerable.
 *
 * Add to an MCP client:
 *   { "command": "npx", "args": ["design-history", "mcp"], "cwd": "<your project>" }
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getCommitDiff, getRepoRoot, isGitRepo } from '../core/git.js';
import { loadManifest } from '../core/manifest.js';
import { snapshotDir } from '../core/paths.js';
import type { Manifest, SnapshotEntry } from '../core/types.js';

function resolveRef(s: SnapshotEntry, byId: Map<string, SnapshotEntry>): SnapshotEntry | null {
  let cur: SnapshotEntry | undefined = s;
  const seen = new Set<string>();
  while (cur) {
    if (cur.state === 'done' && cur.frames.length) return cur;
    if (cur.state !== 'skipped' || !cur.referenceFrame || seen.has(cur.id)) return null;
    seen.add(cur.id);
    cur = byId.get(cur.referenceFrame);
  }
  return null;
}

function findVersion(m: Manifest, version: string): SnapshotEntry | null {
  const done = m.snapshots.filter((s) => s.state === 'done');
  const v = version.trim().toLowerCase();
  if (v === 'latest' || v === 'head' || v === 'newest') return done[done.length - 1] ?? null;
  if (v === 'first' || v === 'oldest') return done[0] ?? null;
  return (
    m.snapshots.find((s) => s.id === version || s.git.shortSha === version) ??
    m.snapshots.find((s) => s.id.startsWith(v) || s.git.shortSha.startsWith(v)) ??
    null
  );
}

export async function runMcp(opts: { cwd?: string } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.env.DESIGN_HISTORY_CWD ?? process.cwd();
  if (!isGitRepo(cwd)) {
    // Fail loudly on stderr; MCP clients surface this.
    process.stderr.write('design-history mcp: not inside a git repository.\n');
    process.exit(1);
  }
  const projectRoot = getRepoRoot(cwd);

  const server = new McpServer({ name: 'design-history', version: '0.1.0' });

  server.registerTool(
    'list_versions',
    {
      title: 'List captured versions',
      description:
        "List the app's captured versions (git commits) with date, message, author, and which routes were captured. Optionally filter by text or date range.",
      inputSchema: {
        query: z.string().optional().describe('Case-insensitive text match on commit message/author/sha.'),
        since: z.string().optional().describe('Only versions on/after this date (ISO or YYYY-MM-DD).'),
        until: z.string().optional().describe('Only versions on/before this date.'),
        limit: z.number().int().positive().optional().describe('Max versions to return (newest first).'),
      },
    },
    async ({ query, since, until, limit }) => {
      const m = loadManifest(projectRoot);
      const sinceT = since ? Date.parse(since) : undefined;
      const untilT = until ? Date.parse(until) : undefined;
      const q = query?.toLowerCase();
      let rows = m.snapshots.filter((s) => {
        const t = Date.parse(s.git.isoTime);
        if (sinceT !== undefined && t < sinceT) return false;
        if (untilT !== undefined && t > untilT) return false;
        if (q) {
          const hay = `${s.git.message} ${s.git.author} ${s.git.shortSha}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      rows = rows.reverse(); // newest first
      if (limit) rows = rows.slice(0, limit);
      const lines = rows.map((s) => {
        const routes = [...new Set(s.frames.map((f) => f.routePath))].join(', ') || '—';
        const date = new Date(s.git.isoTime).toISOString().slice(0, 10);
        return `${s.git.shortSha}  ${date}  [${s.state}]  routes: ${routes}  — ${s.git.message}`;
      });
      const text =
        `${rows.length} version(s) in ${m.projectName}:\n` +
        (lines.join('\n') || '(none)') +
        `\n\nUse get_screenshot with a shortSha (or "latest"/"first") to see any version.`;
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'get_screenshot',
    {
      title: 'Get a version screenshot',
      description:
        'Return the screenshot of a captured version as an image. Accepts a commit sha/shortSha, or "latest"/"first". Optionally pick a route and viewport.',
      inputSchema: {
        version: z.string().describe('Commit sha, shortSha, or "latest"/"first".'),
        route: z.string().optional().describe('Route path (default: the first captured route).'),
        viewport: z.string().optional().describe('Viewport name, e.g. "desktop" or "mobile".'),
      },
    },
    async ({ version, route, viewport }) => {
      const m = loadManifest(projectRoot);
      const byId = new Map(m.snapshots.map((s) => [s.id, s]));
      const snap = findVersion(m, version);
      if (!snap) return { content: [{ type: 'text', text: `No version matched "${version}".` }], isError: true };
      const eff = snap.state === 'skipped' ? resolveRef(snap, byId) : snap;
      if (!eff) return { content: [{ type: 'text', text: `Version ${snap.git.shortSha} has no captured frame.` }], isError: true };

      const routes = [...new Set(eff.frames.map((f) => f.routePath))];
      const viewports = [...new Set(eff.frames.map((f) => f.viewport))];
      const wantRoute = route ?? routes[0];
      const wantVp = viewport ?? (viewports.includes('desktop') ? 'desktop' : viewports[0]);
      const frame = eff.frames.find((f) => f.routePath === wantRoute && f.viewport === wantVp);
      if (!frame) {
        return {
          content: [{ type: 'text', text: `No frame for route "${wantRoute}" @ "${wantVp}". Available routes: ${routes.join(', ')}; viewports: ${viewports.join(', ')}.` }],
          isError: true,
        };
      }
      const file = path.join(snapshotDir(projectRoot, eff.id), frame.file);
      if (!fs.existsSync(file)) return { content: [{ type: 'text', text: 'Screenshot file missing on disk.' }], isError: true };
      const data = fs.readFileSync(file).toString('base64');
      const d = new Date(snap.git.isoTime).toISOString().slice(0, 10);
      return {
        content: [
          { type: 'text', text: `${snap.git.shortSha} · ${d} · ${wantRoute} @ ${wantVp} · ${snap.git.message}` },
          { type: 'image', data, mimeType: 'image/png' },
        ],
      };
    },
  );

  server.registerTool(
    'get_diff',
    {
      title: 'Get what changed in a version',
      description: 'Return the code changes a version introduced: files changed with line counts, and the patch.',
      inputSchema: {
        version: z.string().describe('Commit sha, shortSha, or "latest"/"first".'),
      },
    },
    async ({ version }) => {
      const m = loadManifest(projectRoot);
      const snap = findVersion(m, version);
      if (!snap) return { content: [{ type: 'text', text: `No version matched "${version}".` }], isError: true };
      const diff = getCommitDiff(projectRoot, snap.git.sha);
      const filesText = diff.files.map((f) => `  ${f.file}  +${f.added}/-${f.removed}`).join('\n') || '  (no file changes)';
      const text =
        `${snap.git.shortSha} — ${snap.git.message}\n\nFiles:\n${filesText}\n\nPatch:\n${diff.patch}` +
        (diff.truncated ? '\n… (patch truncated)' : '');
      return { content: [{ type: 'text', text }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive; the transport handles stdin/stdout.
}
