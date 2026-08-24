/**
 * `design-history replay` — render your captured history into a shareable video
 * (or GIF): one frame per version, in order, so your interface visibly evolves.
 * The launch artifact.
 *
 * Uses ffmpeg (system, or the copy Playwright already downloaded) to stitch the
 * per-commit PNGs — no browser needed, since the frames are already on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoRoot, isGitRepo } from '../core/git.js';
import { loadManifest } from '../core/manifest.js';
import { historyRoot, snapshotDir } from '../core/paths.js';
import type { Manifest, SnapshotEntry } from '../core/types.js';

export interface ReplayOptions {
  cwd?: string;
  out?: string;
  route?: string;
  viewport?: string;
  /** How long each version is held, in ms. Default 600. */
  perFrameMs?: number;
  /** Render a GIF instead of MP4. */
  gif?: boolean;
}

export async function runReplay(opts: ReplayOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isGitRepo(cwd)) throw new Error('Not in a git repository.');
  const projectRoot = getRepoRoot(cwd);
  const manifest = loadManifest(projectRoot);
  if (manifest.snapshots.length === 0) {
    throw new Error('No history yet. Run `design-history backfill` first.');
  }

  const routes = [...new Set(manifest.snapshots.flatMap((s) => s.frames.map((f) => f.routePath)))];
  const viewports = [...new Set(manifest.snapshots.flatMap((s) => s.frames.map((f) => f.viewport)))];
  const route = opts.route ?? routes[0];
  const viewport = opts.viewport ?? (viewports.includes('desktop') ? 'desktop' : viewports[0]);
  if (!route || !viewport) throw new Error('No captured frames to replay yet.');

  const files = collectFrames(manifest, projectRoot, route, viewport);
  if (files.length < 2) {
    throw new Error(
      `Need at least 2 captured versions for ${route} @ ${viewport} (found ${files.length}).`,
    );
  }

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      'ffmpeg is required to render a replay. Install it (e.g. `brew install ffmpeg`) and retry.',
    );
  }

  const perFrame = Math.max(0.05, (opts.perFrameMs ?? 600) / 1000);
  const out =
    opts.out ?? path.join(historyRoot(projectRoot), opts.gif ? 'replay.gif' : 'replay.mp4');

  // ffmpeg concat demuxer: each frame held for `perFrame`, last one repeated
  // (a demuxer quirk — the final entry's duration is otherwise ignored).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-replay-'));
  const listPath = path.join(tmp, 'frames.txt');
  const lines: string[] = [];
  for (const f of files) {
    lines.push(`file '${escapePath(f)}'`);
    lines.push(`duration ${perFrame}`);
  }
  lines.push(`file '${escapePath(files[files.length - 1]!)}'`);
  fs.writeFileSync(listPath, lines.join('\n'));

  // Even dimensions are required for yuv420p / mp4.
  const scale = 'scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos';
  // GIF: downscale to a shareable width and build a per-clip palette (quality + size).
  const gifFilter =
    'scale=900:-2:flags=lanczos,fps=12,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer';
  const args = opts.gif
    ? ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-vf', gifFilter, out]
    : [
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
        '-vf', scale, '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out,
      ];

  console.log(
    `→ Rendering ${files.length} versions of ${route} @ ${viewport} → ${path.relative(cwd, out)}`,
  );
  const res = spawnSync(ffmpeg, args, { stdio: 'pipe' });
  fs.rmSync(tmp, { recursive: true, force: true });
  if (res.status !== 0) {
    const tail = (res.stderr?.toString() ?? '').split('\n').filter(Boolean).slice(-3).join('\n  ');
    throw new Error(`ffmpeg failed:\n  ${tail}`);
  }

  const seconds = (files.length * perFrame).toFixed(1);
  console.log(
    `✓ ${path.relative(cwd, out)} — ${files.length} versions, ${seconds}s. Drop it on X. 🎞️`,
  );
}

/** Chronological frame files for one route+viewport, following skip references. */
function collectFrames(
  manifest: Manifest,
  projectRoot: string,
  route: string,
  viewport: string,
): string[] {
  const byId = new Map(manifest.snapshots.map((s) => [s.id, s]));
  const files: string[] = [];
  for (const s of manifest.snapshots) {
    const eff = s.state === 'skipped' ? resolveRef(s, byId) : s;
    if (!eff) continue;
    const frame = eff.frames.find((f) => f.routePath === route && f.viewport === viewport);
    if (!frame) continue;
    const p = path.join(snapshotDir(projectRoot, eff.id), frame.file);
    if (fs.existsSync(p)) files.push(p);
  }
  return files;
}

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

function escapePath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

/** System ffmpeg, else the one Playwright downloaded. */
function findFfmpeg(): string | null {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0) return 'ffmpeg';
  const caches = [
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ];
  for (const base of caches) {
    try {
      if (!fs.existsSync(base)) continue;
      const dir = fs.readdirSync(base).find((d) => d.startsWith('ffmpeg-'));
      if (!dir) continue;
      const inner = path.join(base, dir);
      const bin = fs.readdirSync(inner).find((f) => f.startsWith('ffmpeg') && !f.endsWith('.txt'));
      if (bin && fs.existsSync(path.join(inner, bin))) return path.join(inner, bin);
    } catch {
      /* keep looking */
    }
  }
  return null;
}
