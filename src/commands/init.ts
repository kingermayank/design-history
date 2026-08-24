import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getRepoRoot, isGitRepo } from '../core/git.js';
import { configPath, historyRoot } from '../core/paths.js';
import { defaultConfigSource } from '../core/config.js';

const HOOK_TEMPLATE = `#!/usr/bin/env bash
# design-history post-commit hook
# Runs capture in the background so it never blocks your commit.
set -u
LOG=".design-history/hook.log"
mkdir -p .design-history
SHA="$(git rev-parse HEAD 2>/dev/null || echo HEAD)"
nohup npx design-history capture --commit "$SHA" >> "$LOG" 2>&1 &
disown 2>/dev/null || true
exit 0
`;

export interface InitOptions {
  cwd?: string;
  /** Commit screenshots to git, or gitignore them. Default: gitignore. */
  commitSnapshots?: boolean;
  /** Skip Playwright browser install. */
  skipBrowserInstall?: boolean;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  if (!isGitRepo(cwd)) {
    throw new Error('design-history needs a git repository. Run `git init` first.');
  }
  const projectRoot = getRepoRoot(cwd);

  writeConfig(projectRoot);
  writeGitignore(projectRoot, opts.commitSnapshots ?? false);
  installHook(projectRoot);
  ensureHistoryDir(projectRoot);
  const vite = adviseVitePlugin(projectRoot);

  if (!opts.skipBrowserInstall) {
    console.log('→ Installing Playwright Chromium (one-time)…');
    try {
      execFileSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
    } catch {
      console.log(
        '  ! Could not auto-install Playwright Chromium. Run `npx playwright install chromium` manually.',
      );
    }
  }

  console.log('\n✓ design-history is set up.\n');
  console.log('Next steps:');
  console.log('  1. Edit design-history.config.js — set your dev URL and routes.');
  if (vite.found && !vite.wired) {
    console.log('  2. Add the in-app time-travel button to your Vite config:');
    console.log('       import designHistory from \'design-history/vite\'');
    console.log('       plugins: [ …, designHistory() ]');
    console.log('     (' + vite.file + ')');
  }
  console.log('  3. Run `npx design-history backfill` to reconstruct your history.');
  console.log('  4. Run `npx design-history view` (or start your dev server to see the floating button).');
}

/** Detect a Vite config and tell the user how to wire the in-app FAB. */
function adviseVitePlugin(projectRoot: string): { found: boolean; wired: boolean; file: string } {
  const names = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];
  const file = names.find((n) => fs.existsSync(path.join(projectRoot, n)));
  if (!file) {
    console.log('  ✓ no Vite config found — the in-app button needs Vite; the CLI viewer works regardless');
    return { found: false, wired: false, file: '' };
  }
  const contents = fs.readFileSync(path.join(projectRoot, file), 'utf8');
  const wired = contents.includes('design-history/vite') || contents.includes('designHistory(');
  if (wired) {
    console.log('  ✓ Vite plugin already wired in ' + file);
  } else {
    console.log('  • add `designHistory()` to ' + file + ' for the in-app time-travel button');
  }
  return { found: true, wired, file };
}

function writeConfig(projectRoot: string): void {
  const target = configPath(projectRoot);
  if (fs.existsSync(target)) {
    console.log(`  ✓ ${path.relative(projectRoot, target)} already exists — left alone`);
    return;
  }
  fs.writeFileSync(target, defaultConfigSource(), 'utf8');
  console.log(`  ✓ wrote ${path.relative(projectRoot, target)}`);
}

function writeGitignore(projectRoot: string, commitSnapshots: boolean): void {
  const file = path.join(projectRoot, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines: string[] = [];
  if (!existing.includes('.design-history/auth.json')) lines.push('.design-history/auth.json');
  if (!existing.includes('.design-history/.worktrees')) lines.push('.design-history/.worktrees');
  if (!existing.includes('.design-history/.cache')) lines.push('.design-history/.cache');
  if (!existing.includes('.design-history/backfill-state.json'))
    lines.push('.design-history/backfill-state.json');
  if (!existing.includes('.design-history/hook.log')) lines.push('.design-history/hook.log');
  if (!commitSnapshots && !existing.includes('.design-history/snapshots')) {
    lines.push('.design-history/snapshots');
  }
  if (lines.length === 0) {
    console.log('  ✓ .gitignore already covers .design-history');
    return;
  }
  const block = `\n# design-history\n${lines.join('\n')}\n`;
  fs.writeFileSync(file, existing + block, 'utf8');
  console.log(`  ✓ updated .gitignore (${lines.length} entries)`);
}

function installHook(projectRoot: string): void {
  const hookDir = path.join(projectRoot, '.git', 'hooks');
  const hookFile = path.join(hookDir, 'post-commit');

  fs.mkdirSync(hookDir, { recursive: true });
  if (fs.existsSync(hookFile)) {
    const existing = fs.readFileSync(hookFile, 'utf8');
    if (existing.includes('design-history capture')) {
      console.log('  ✓ post-commit hook already wired');
      return;
    }
    const merged = `${existing.trimEnd()}\n\n# --- design-history ---\n${HOOK_TEMPLATE.replace(/^#!.*\n/, '')}`;
    fs.writeFileSync(hookFile, merged, { mode: 0o755 });
    console.log('  ✓ appended to existing post-commit hook');
  } else {
    fs.writeFileSync(hookFile, HOOK_TEMPLATE, { mode: 0o755 });
    console.log('  ✓ installed .git/hooks/post-commit');
  }
  try {
    fs.chmodSync(hookFile, 0o755);
  } catch {
    /* noop */
  }
}

function ensureHistoryDir(projectRoot: string): void {
  fs.mkdirSync(historyRoot(projectRoot), { recursive: true });
}
