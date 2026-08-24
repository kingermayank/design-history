import { Command } from 'commander';
import { runInit } from './commands/init.js';
import { runCapture } from './commands/capture.js';
import { runBackfill } from './commands/backfill.js';
import { runView } from './commands/view.js';
import { runAuth } from './commands/auth.js';
import { runSnap } from './commands/snap.js';
import { runWatch } from './commands/watch.js';
import { runReplay } from './commands/replay.js';
import { runMcp } from './commands/mcp.js';
import { clearCache, formatBytes } from './core/installCache.js';
import { getRepoRoot, isGitRepo } from './core/git.js';

const program = new Command();

program
  .name('design-history')
  .description('Visual git history for designers — auto-screenshot every commit.')
  .version('0.1.0');

program
  .command('init')
  .description('Set up design-history in this repo (config, git hook, .gitignore).')
  .option('--commit-snapshots', 'Commit screenshots to git (default: gitignored).')
  .option('--skip-browser-install', 'Skip the Playwright Chromium download.')
  .action(async (opts) => {
    await runInit({
      commitSnapshots: opts.commitSnapshots,
      skipBrowserInstall: opts.skipBrowserInstall,
    });
  });

program
  .command('capture')
  .description('Capture screenshots for a commit. Called by the post-commit hook.')
  .option('--commit <sha>', 'Commit SHA (default: HEAD).')
  .action(async (opts) => {
    try {
      await runCapture({ commit: opts.commit });
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('backfill')
  .description('Walk past commits and capture each in an isolated worktree.')
  .option('--from <sha>', 'Start after this commit (exclusive).')
  .option('--limit <n>', 'Cap the number of commits to backfill.', (v) => parseInt(v, 10))
  .option('--branch <name>', 'Use this branch (default: current).')
  .action(async (opts) => {
    try {
      await runBackfill({ from: opts.from, limit: opts.limit, branch: opts.branch });
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('snap [label]')
  .description('Ad-hoc capture for a moment that isn\'t a commit.')
  .action(async (label) => {
    await runSnap(label);
  });

program
  .command('watch')
  .description('Attach to your already-running dev server and capture on each commit.')
  .option('--interval <sec>', 'Also snap every N seconds while iterating.', (v) => parseInt(v, 10))
  .action(async (opts) => {
    try {
      await runWatch({ intervalSec: opts.interval });
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('replay')
  .description('Render your history into a shareable video (or GIF).')
  .option('--out <file>', 'Output path (default: .design-history/replay.mp4).')
  .option('--route <path>', 'Which route to replay (default: the first).')
  .option('--viewport <name>', 'Which viewport (default: desktop).')
  .option('--per-frame <ms>', 'Hold each version this long.', (v) => parseInt(v, 10))
  .option('--gif', 'Render a GIF instead of MP4.')
  .action(async (opts) => {
    try {
      await runReplay({
        out: opts.out,
        route: opts.route,
        viewport: opts.viewport,
        perFrameMs: opts.perFrame,
        gif: opts.gif === true,
      });
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exitCode = 1;
    }
  });

program
  .command('auth')
  .description('Open a browser, save cookies/localStorage for captures that need login.')
  .action(async () => {
    await runAuth();
  });

program
  .command('view')
  .description('Open the timeline viewer in your browser.')
  .option('--port <n>', 'Port to bind (default: random).', (v) => parseInt(v, 10))
  .option('--no-open', 'Do not auto-open the browser.')
  .option('--no-capture', 'Do not run the background capture worker (read-only).')
  .action(async (opts) => {
    await runView({
      port: opts.port,
      noOpen: opts.open === false,
      capture: opts.capture !== false,
    });
  });

const cache = program.command('cache').description('Manage the install cache.');
cache
  .command('clear')
  .description('Delete every cached node_modules tree (.design-history/.cache).')
  .action(() => {
    if (!isGitRepo(process.cwd())) {
      console.error('Not in a git repository.');
      process.exit(1);
    }
    const root = getRepoRoot(process.cwd());
    const { removed } = clearCache(root);
    console.log(`✓ Cleared install cache${removed ? ` (~${formatBytes(removed)} freed)` : ''}.`);
  });

program
  .command('mcp')
  .description('Start an MCP server (stdio) so agents can query your visual history.')
  .action(async () => {
    await runMcp();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
