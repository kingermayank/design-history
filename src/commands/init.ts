import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { getRepoRoot, isGitRepo } from '../core/git.js';
import { configPath, historyRoot } from '../core/paths.js';
import { defaultConfigSource } from '../core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OVERLAY_ROUTE = '__design-history';

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
  const app = setupInAppButton(projectRoot);

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
  console.log('  2. Run `npx design-history backfill` to reconstruct your history.');
  console.log('  3. See it — the in-app button for your stack:\n');
  app.instructions.forEach((line) => console.log('     ' + line));
}

/**
 * Detect the framework and wire the in-app floating button for it. Serves the
 * captured history from the app's public/static dir so any framework can fetch
 * it, then prints the one-line setup for that stack.
 */
function setupInAppButton(projectRoot: string): { framework: string; instructions: string[] } {
  const fw = detectFramework(projectRoot);
  console.log(`  ✓ detected framework: ${fw.name}`);

  let served = false;
  if (fw.publicDir) {
    const publicDir = path.join(projectRoot, fw.publicDir);
    if (fs.existsSync(publicDir)) {
      served = linkPublic(projectRoot, publicDir);
      copyOverlayBundle(projectRoot);
      if (served) console.log(`  ✓ serving history at /${OVERLAY_ROUTE} (${fw.publicDir}/ symlink)`);
    }
  }

  const viteFile = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'].find(
    (n) => fs.existsSync(path.join(projectRoot, n)),
  );

  const out: string[] = [];
  if (fw.injection === 'vite-plugin' && viteFile) {
    out.push(`Add the Vite plugin to ${viteFile}:`);
    out.push("  import designHistory from 'design-history/vite'");
    out.push('  plugins: [ …, designHistory() ]');
    out.push('Then run your dev server — the button appears bottom-right.');
  } else if (fw.injection === 'react-component') {
    out.push(`Add the component to your app root (${fw.rootHint}):`);
    out.push("  import { DesignHistory } from 'design-history/react'");
    out.push('  …then render  <DesignHistory />  near the end of <body>.');
    out.push('Then run your dev server — the button appears bottom-right.');
    if (!served) out.push(`(No ${fw.publicDir}/ dir yet — create one so the history can be served.)`);
  } else {
    out.push('Add this to your HTML before </body>:');
    out.push(`  <script type="module" src="/${OVERLAY_ROUTE}/overlay.js"></script>`);
    if (!served) out.push(`(Serve the .design-history folder at /${OVERLAY_ROUTE}.)`);
  }
  out.push('');
  out.push('Prefer a full page? Run `npx design-history view` any time.');
  return { framework: fw.name, instructions: out };
}

interface FrameworkInfo {
  name: string;
  injection: 'vite-plugin' | 'react-component' | 'script-tag';
  publicDir: string | null;
  rootHint: string;
}

function detectFramework(projectRoot: string): FrameworkInfo {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    /* no package.json */
  }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const has = (n: string): boolean => n in deps;

  if (has('next'))
    return { name: 'Next.js', injection: 'react-component', publicDir: 'public', rootHint: 'app/layout.tsx or pages/_app.tsx' };
  if (has('vite'))
    return { name: 'Vite', injection: 'vite-plugin', publicDir: 'public', rootHint: 'your root component' };
  if (has('@remix-run/react') || has('@remix-run/node'))
    return { name: 'Remix', injection: 'react-component', publicDir: 'public', rootHint: 'app/root.tsx' };
  if (has('react-scripts'))
    return { name: 'Create React App', injection: 'react-component', publicDir: 'public', rootHint: 'src/index.tsx' };
  if (has('@sveltejs/kit'))
    return { name: 'SvelteKit', injection: 'script-tag', publicDir: 'static', rootHint: 'src/app.html' };
  if (has('astro'))
    return { name: 'Astro', injection: 'script-tag', publicDir: 'public', rootHint: 'your base layout' };
  if (has('nuxt'))
    return { name: 'Nuxt', injection: 'script-tag', publicDir: 'public', rootHint: 'app.vue' };
  if (has('react'))
    return { name: 'React', injection: 'react-component', publicDir: 'public', rootHint: 'your root component' };
  return { name: 'unknown', injection: 'script-tag', publicDir: 'public', rootHint: 'your HTML' };
}

/** Symlink the app's public dir → .design-history so the overlay can fetch it. */
function linkPublic(projectRoot: string, publicDir: string): boolean {
  const linkPath = path.join(publicDir, OVERLAY_ROUTE);
  try {
    if (isSymlink(linkPath) || fs.existsSync(linkPath)) return true;
    const target = path.relative(publicDir, historyRoot(projectRoot));
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Copy the overlay bundle into .design-history so /__design-history/overlay.js resolves. */
function copyOverlayBundle(projectRoot: string): void {
  const candidates = [
    path.resolve(__dirname, 'plugin/overlay.js'),
    path.resolve(__dirname, '../dist/plugin/overlay.js'),
    path.resolve(__dirname, '../../dist/plugin/overlay.js'),
  ];
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) return;
  try {
    fs.copyFileSync(src, path.join(historyRoot(projectRoot), 'overlay.js'));
  } catch {
    /* non-fatal */
  }
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
  const add = (entry: string): void => {
    if (!existing.includes(entry)) lines.push(entry);
  };
  add('.design-history/auth.json');
  add('.design-history/.worktrees');
  add('.design-history/.cache');
  add('.design-history/backfill-state.json');
  add('.design-history/hook.log');
  add('public/__design-history');
  add('static/__design-history');
  if (!commitSnapshots) add('.design-history/snapshots');
  if (lines.length === 0) {
    console.log('  ✓ .gitignore already covers design-history');
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
