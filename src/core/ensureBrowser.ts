import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

let ensured = false;

/**
 * Guarantee Playwright's Chromium is present before we try to launch it.
 *
 * `npm i playwright` installs the library but NOT the ~150 MB browser binary,
 * so on a fresh machine the very first capture would fail with an obscure
 * "Executable doesn't exist" error. Rather than push a manual
 * `npx playwright install chromium` onto every new user (or a heavy postinstall
 * that runs even for `npx` one-offs), we download it lazily, once, the first
 * time a capture actually needs it — with a friendly progress message.
 *
 * Idempotent and cheap: after the first check this returns immediately.
 */
export async function ensureChromium(): Promise<void> {
  if (ensured) return;
  if (browserInstalled()) {
    ensured = true;
    return;
  }

  console.log('\n  ⬇  First run: installing Chromium for design-history (one-time, ~150 MB)…\n');
  try {
    const require = createRequire(import.meta.url);
    // playwright/cli.js isn't an exported subpath, but package.json is — resolve
    // that to find the package root, then run its CLI installer with our Node.
    const cliPath = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    execFileSync(process.execPath, [cliPath, 'install', 'chromium'], { stdio: 'inherit' });
  } catch (err) {
    throw new Error(
      'Could not install Chromium automatically. ' +
        'Run "npx playwright install chromium" once, then try again.\n' +
        `  (${(err as Error).message})`,
    );
  }

  if (!browserInstalled()) {
    throw new Error(
      'Chromium install finished but the browser was not found. ' +
        'Try "npx playwright install chromium".',
    );
  }
  console.log('\n  ✓  Chromium ready.\n');
  ensured = true;
}

function browserInstalled(): boolean {
  try {
    const exe = chromium.executablePath();
    return !!exe && fs.existsSync(exe);
  } catch {
    return false;
  }
}
