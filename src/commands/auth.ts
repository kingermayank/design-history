import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig } from '../core/config.js';
import { getRepoRoot, isGitRepo } from '../core/git.js';
import { authPath, historyRoot } from '../core/paths.js';
import { ensureChromium } from '../core/ensureBrowser.js';

export async function runAuth(): Promise<void> {
  const cwd = process.cwd();
  if (!isGitRepo(cwd)) throw new Error('Not in a git repository.');
  const projectRoot = getRepoRoot(cwd);
  const config = await loadConfig(projectRoot);

  console.log('\n→ Opening a browser. Log in / navigate to whatever state you want captured.');
  console.log('  Close the window when you are done. Cookies + localStorage will be saved.\n');

  await ensureChromium();
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(config.devServer).catch(() => {});

  await new Promise<void>((resolve) => {
    page.on('close', () => resolve());
    context.on('close', () => resolve());
    browser.on('disconnected', () => resolve());
  });

  fs.mkdirSync(historyRoot(projectRoot), { recursive: true });
  const file = authPath(projectRoot);
  await context.storageState({ path: file }).catch(() => {});
  try {
    await browser.close();
  } catch {
    /* noop */
  }
  console.log(`✓ Saved auth state → ${path.relative(cwd, file)}`);
}
