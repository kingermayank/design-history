/**
 * `design-history watch` — attach to the dev server you already have running
 * and capture your live app. No worktree, no install, no boot: the unfailable
 * first-run path. Captures immediately, then again on every new commit (and,
 * optionally, on an interval while you iterate).
 */
import { loadConfig } from '../core/config.js';
import { isReachable } from '../core/devServer.js';
import { getRepoRoot, isGitRepo, readCommitMeta } from '../core/git.js';
import { runCapture } from './capture.js';

export interface WatchOptions {
  cwd?: string;
  /** Also capture every N seconds, tagged as a session snap. */
  intervalSec?: number;
}

export async function runWatch(opts: WatchOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isGitRepo(cwd)) throw new Error('Not in a git repository.');
  const projectRoot = getRepoRoot(cwd);
  const config = await loadConfig(projectRoot);

  const up = await isReachable(config.devServer, 2500);
  if (!up) {
    throw new Error(
      `Your dev server isn't reachable at ${config.devServer}.\n` +
        '  Start it (e.g. `npm run dev`), then run `design-history watch` again.\n' +
        '  (Or set the right URL in design-history.config.js.)',
    );
  }

  console.log(`→ Attached to ${config.devServer} — capturing your live app (nothing booted).`);
  await runCapture({ cwd, source: 'live', skipExisting: false });

  let lastSha = safeHead(projectRoot);
  console.log('\n👁  Watching for new commits — Ctrl+C to stop.');
  if (opts.intervalSec && opts.intervalSec > 0) {
    console.log(`   Also snapping every ${opts.intervalSec}s while the server is up.`);
  }

  let stopped = false;

  const headTimer = setInterval(() => {
    void (async () => {
      if (stopped) return;
      const head = safeHead(projectRoot);
      if (head && head !== lastSha) {
        lastSha = head;
        if (await isReachable(config.devServer, 2000)) {
          await runCapture({ cwd, source: 'live', commit: head, skipExisting: true }).catch(
            () => {},
          );
        }
      }
    })();
  }, 3000);

  let snapTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.intervalSec && opts.intervalSec > 0) {
    snapTimer = setInterval(() => {
      void (async () => {
        if (stopped) return;
        if (await isReachable(config.devServer, 2000)) {
          await runCapture({ cwd, source: 'snap', label: 'watch', skipExisting: false }).catch(
            () => {},
          );
        }
      })();
    }, opts.intervalSec * 1000);
  }

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      stopped = true;
      clearInterval(headTimer);
      if (snapTimer) clearInterval(snapTimer);
      console.log('\n✓ Stopped watching. Run `design-history view` to browse.');
      resolve();
    });
  });
}

function safeHead(projectRoot: string): string | null {
  try {
    return readCommitMeta(projectRoot).sha;
  } catch {
    return null;
  }
}
