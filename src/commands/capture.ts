import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import { isReachable } from '../core/devServer.js';
import { getRepoRoot, isGitRepo, readCommitMeta } from '../core/git.js';
import { captureBundle } from '../core/playwright.js';
import { resolveRoutes } from '../core/routeDiscovery.js';
import { hasSnapshot, upsertSnapshot } from '../core/manifest.js';
import { skippedLogPath, snapshotDir } from '../core/paths.js';
import type { FrameSource, SnapshotEntry } from '../core/types.js';

export interface CaptureOptions {
  cwd?: string;
  commit?: string;
  source?: FrameSource;
  label?: string;
  /** Skip if a snapshot for this commit already exists. Default true. */
  skipExisting?: boolean;
  /** Override the base URL (used by backfill). */
  baseUrl?: string;
  /** Suppress dev-server reachability check (used by backfill, server is known up). */
  skipReachabilityCheck?: boolean;
}

export async function runCapture(opts: CaptureOptions = {}): Promise<SnapshotEntry | null> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isGitRepo(cwd)) {
    throw new Error('Not in a git repository.');
  }
  const projectRoot = getRepoRoot(cwd);
  const config = await loadConfig(projectRoot);
  const source: FrameSource = opts.source ?? 'live';
  const git = readCommitMeta(projectRoot, opts.commit);

  const id = source === 'snap' ? `snap-${Date.now().toString(36)}` : git.sha;

  if (opts.skipExisting !== false && hasSnapshot(projectRoot, id)) {
    console.log(`✓ Snapshot already exists for ${git.shortSha} — skipping.`);
    return null;
  }

  const baseUrl = opts.baseUrl ?? config.devServer;
  if (!opts.skipReachabilityCheck) {
    const up = await isReachable(baseUrl, 2000);
    if (!up) {
      const note = `[${new Date().toISOString()}] ${git.shortSha} — dev server not reachable at ${baseUrl}\n`;
      fs.mkdirSync(path.dirname(skippedLogPath(projectRoot)), { recursive: true });
      fs.appendFileSync(skippedLogPath(projectRoot), note);
      console.log(`! Dev server not reachable at ${baseUrl} — capture skipped (${git.shortSha}).`);
      return null;
    }
  }

  const outDir = snapshotDir(projectRoot, id);
  console.log(
    `→ Capturing ${git.shortSha} "${git.message}"`,
  );
  const routes = await resolveRoutes(projectRoot, config, baseUrl);
  const frames = await captureBundle({ projectRoot, config, outDir, baseUrl, routes });

  const entry: SnapshotEntry = {
    id,
    source,
    state: 'done',
    git,
    frames,
    label: opts.label,
    capturedAt: new Date().toISOString(),
    stateChangedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(entry, null, 2));
  upsertSnapshot(projectRoot, entry);
  console.log(`✓ Captured ${frames.length} frames → ${path.relative(cwd, outDir)}`);
  return entry;
}
