import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.js';
import {
  getRepoRoot,
  isGitRepo,
  pruneWorktrees,
} from '../core/git.js';
import {
  captureCommitFromHistory,
  closeHistoryCaptureSession,
  createHistoryCaptureSession,
} from '../core/historyCapture.js';
import { hasDoneSnapshot } from '../core/manifest.js';
import { buildSkeletonManifest } from '../core/skeleton.js';
import {
  backfillLogPath,
  backfillStatePath,
  historyRoot,
} from '../core/paths.js';

export interface BackfillOptions {
  cwd?: string;
  from?: string;
  limit?: number;
  branch?: string;
}

interface BackfillState {
  completed: string[];
  failed: { sha: string; reason: string }[];
  startedAt: string;
}

function loadState(projectRoot: string): BackfillState {
  const p = backfillStatePath(projectRoot);
  if (!fs.existsSync(p)) {
    return { completed: [], failed: [], startedAt: new Date().toISOString() };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as BackfillState;
}

function saveState(projectRoot: string, state: BackfillState): void {
  fs.mkdirSync(historyRoot(projectRoot), { recursive: true });
  fs.writeFileSync(backfillStatePath(projectRoot), JSON.stringify(state, null, 2));
}

function logSkip(projectRoot: string, sha: string, reason: string): void {
  fs.mkdirSync(historyRoot(projectRoot), { recursive: true });
  fs.appendFileSync(
    backfillLogPath(projectRoot),
    `[${new Date().toISOString()}] ${sha} — ${reason}\n`,
  );
}

export async function runBackfill(opts: BackfillOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isGitRepo(cwd)) throw new Error('Not in a git repository.');
  const projectRoot = getRepoRoot(cwd);
  const config = await loadConfig(projectRoot);

  pruneWorktrees(projectRoot);

  // Build the skeleton so smart-skip applies here too — backfill should never
  // render a commit the skeleton already decided is non-visual.
  const manifest = buildSkeletonManifest({
    projectRoot,
    config,
    limit: opts.limit,
    branch: opts.branch,
  });

  // Walk in chronological order; honor --from and --limit.
  let entries = manifest.snapshots.slice();
  if (opts.from) {
    const idx = entries.findIndex((s) => s.id.startsWith(opts.from!) || s.git.shortSha === opts.from);
    entries = idx >= 0 ? entries.slice(idx + 1) : entries;
  }
  if (opts.limit && opts.limit > 0) {
    entries = entries.slice(-opts.limit);
  }

  const capturable = entries.filter(
    (s) => s.state === 'pending' || s.state === 'queued' || s.state === 'failed',
  );
  const autoSkipped = entries.filter((s) => s.state === 'skipped').length;
  const alreadyDone = entries.filter((s) => s.state === 'done').length;

  if (capturable.length === 0) {
    console.log(
      `Nothing to backfill. ${alreadyDone} done, ${autoSkipped} auto-skipped (non-visual diffs).`,
    );
    return;
  }

  console.log(`\nBackfill plan: ${capturable.length} commits will be captured`);
  console.log(`  Auto-skipped (non-visual): ${autoSkipped}`);
  console.log(`  Already done:              ${alreadyDone}`);
  console.log(`  Routes:                    ${config.routes.length} × ${config.viewports.length} viewports`);
  console.log(`  Install:                   ${config.installCommand}`);
  console.log(`  Start:                     ${config.startCommand}`);
  console.log(
    `  Fast-path estimate: ${Math.max(1, Math.ceil((capturable.length * 3) / 60))}–${Math.max(1, Math.ceil((capturable.length * 8) / 60))} minutes.\n`,
  );

  const state = loadState(projectRoot);
  const session = await createHistoryCaptureSession(projectRoot);

  try {
    for (let i = 0; i < capturable.length; i++) {
      const c = capturable[i]!;
      const tag = `[${i + 1}/${capturable.length}] ${c.git.shortSha}`;
      if (hasDoneSnapshot(projectRoot, c.id) || state.completed.includes(c.id)) {
        console.log(`${tag} ✓ already captured — skipping`);
        continue;
      }

      try {
        await captureCommitFromHistory(
          {
            projectRoot,
            config,
            sha: c.id,
            shortSha: c.git.shortSha,
            onStage: (stage, detail) =>
              console.log(`${tag} → ${stage}${detail ? ` ${detail}` : ''}`),
          },
          session,
        );
        if (!state.completed.includes(c.id)) state.completed.push(c.id);
        state.failed = state.failed.filter((failure) => failure.sha !== c.id);
        saveState(projectRoot, state);
        console.log(`${tag} ✓ captured`);
      } catch (err) {
        const reason = (err as Error).message ?? String(err);
        console.log(`${tag} ✗ failed: ${reason.split('\n')[0]}`);
        state.failed = state.failed.filter((failure) => failure.sha !== c.id);
        state.failed.push({ sha: c.id, reason });
        saveState(projectRoot, state);
        logSkip(projectRoot, c.id, reason);
      }
    }
  } finally {
    await closeHistoryCaptureSession(projectRoot, session);
  }

  pruneWorktrees(projectRoot);
  console.log(
    `\nBackfill done. Captured: ${state.completed.length}, failed: ${state.failed.length}, auto-skipped: ${autoSkipped}.`,
  );
  if (state.failed.length > 0) {
    console.log(`See ${path.relative(cwd, backfillLogPath(projectRoot))} for details.`);
  }
}
