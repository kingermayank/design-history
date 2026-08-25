/**
 * Capture historical commits by replaying them through a SINGLE long-lived dev
 * server ("hot-swap replay").
 *
 * Naive backfill boots and kills a dev server per commit — 30–90s each, and the
 * boot is where most failures happen. Instead we keep one worktree, one dev
 * server, and one browser alive for the whole run. For each commit we just
 * `git checkout` the source files underneath the running server; its own file
 * watcher recompiles (that's the one thing every dev server is built to do),
 * and a fresh page navigation renders the swapped-in version. Per-commit cost
 * drops to ~2–3s.
 *
 * The server is only restarted when it HAS to be:
 *   - lockfile or a config file (vite.config, next.config, tsconfig, .env, …)
 *     changed, because those load once at boot and a watcher won't pick them up;
 *   - the server died or stopped responding;
 *   - every MAX_REUSE commits, as hygiene against a wedged watcher.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import {
  addWorktree,
  checkoutWorktree,
  pruneWorktrees,
  readCommitMeta,
  removeWorktree,
} from './git.js';
import { startDevServer, isReachable, type ManagedServer } from './devServer.js';
import { captureBundle } from './playwright.js';
import { upsertSnapshot } from './manifest.js';
import { snapshotDir, worktreesRoot } from './paths.js';
import {
  computeCacheKey,
  formatBytes,
  persistToCache,
  restoreFromCache,
} from './installCache.js';
import { resolveRoutes } from './routeDiscovery.js';
import type { DesignHistoryConfig, RouteConfig, SnapshotEntry } from './types.js';

/** Restart the server after this many hot-swaps, regardless, as insurance. */
const MAX_REUSE = 25;
/** Give the dev server's file watcher a beat to notice the checkout. */
const RELOAD_SETTLE_MS = 500;

/** Files that, when changed, require a full server restart (loaded at boot). */
const SERVER_SIGNIFICANT_FILES = [
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'vite.config.cjs',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'svelte.config.js',
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.ts',
  'nuxt.config.js',
  'nuxt.config.ts',
  'remix.config.js',
  'vue.config.js',
  'webpack.config.js',
  'angular.json',
  'tailwind.config.js',
  'tailwind.config.ts',
  'tailwind.config.cjs',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'tsconfig.json',
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
];

export interface SingleCommitOptions {
  projectRoot: string;
  config: DesignHistoryConfig;
  sha: string;
  shortSha: string;
  /** Progress callback: 'checkout' | 'install' | 'boot' | 'reuse' | 'capture'. */
  onStage?: (stage: string, detail?: string) => void;
}

export interface HistoryCaptureSession {
  wtDir: string;
  browser: Browser;
  initialized: boolean;
  dependencyHash: string | null;
  /** The long-lived dev server, kept alive across commits. */
  server: ManagedServer | null;
  /** Signature of the boot-significant files the server was started with. */
  serverSignature: string | null;
  /** How many commits we've hot-swapped since the last (re)start. */
  reuseCount: number;
  /** Concrete routes (resolved once when config.routes is 'auto'). */
  routes: RouteConfig[] | null;
}

export async function createHistoryCaptureSession(
  projectRoot: string,
): Promise<HistoryCaptureSession> {
  const wtDir = path.join(worktreesRoot(projectRoot), 'backfill');
  fs.mkdirSync(worktreesRoot(projectRoot), { recursive: true });
  removeWorktree(projectRoot, wtDir);
  rmDirResilient(wtDir);
  return {
    wtDir,
    browser: await chromium.launch({ headless: true }),
    initialized: false,
    dependencyHash: null,
    server: null,
    serverSignature: null,
    reuseCount: 0,
    routes: null,
  };
}

export async function closeHistoryCaptureSession(
  projectRoot: string,
  session: HistoryCaptureSession,
): Promise<void> {
  if (session.server) {
    await session.server.stop().catch(() => {});
    session.server = null;
  }
  await session.browser.close().catch(() => {});
  removeWorktree(projectRoot, session.wtDir);
  rmDirResilient(session.wtDir);
  pruneWorktrees(projectRoot);
}

export function pickFreePort(): number {
  // Random port in 39000-49000; collisions surface as boot failures.
  return 39000 + Math.floor(Math.random() * 10000);
}

export function rewriteHostPort(url: string, port: number): string {
  try {
    const u = new URL(url);
    u.port = String(port);
    return u.toString().replace(/\/$/, '');
  } catch {
    return `http://localhost:${port}`;
  }
}

export function buildStartCommand(command: string, port: number): string {
  const expanded = command.replaceAll('{port}', String(port));
  return `PORT=${port} ${expanded}`;
}

/**
 * Hash the contents of boot-significant files present in the worktree. If this
 * changes between commits, the running server can't be trusted and we restart.
 * Content-based, so it catches both dependency and config changes without
 * relying on diff parsing.
 */
export function computeServerSignature(wtDir: string): string {
  const h = createHash('sha1');
  for (const rel of SERVER_SIGNIFICANT_FILES) {
    const p = path.join(wtDir, rel);
    if (fs.existsSync(p)) {
      h.update(rel);
      h.update('\0');
      try {
        h.update(fs.readFileSync(p));
      } catch {
        /* unreadable — ignore */
      }
      h.update('\0');
    }
  }
  return h.digest('hex').slice(0, 16);
}

async function startServerForWorktree(
  config: DesignHistoryConfig,
  wtDir: string,
): Promise<ManagedServer> {
  const port = pickFreePort();
  const startCmd = buildStartCommand(config.startCommand!, port);
  const guessed = rewriteHostPort(config.devServer, port);
  // startDevServer already folds the server's last stdout into its error.
  return startDevServer(startCmd, wtDir, guessed, config.serverReadyTimeoutMs ?? 60_000);
}

/**
 * Throws with a human-readable Error on any failure. In session mode the server
 * and worktree live in the session and are torn down by
 * closeHistoryCaptureSession; in standalone mode everything is cleaned up here.
 */
export async function captureCommitFromHistory(
  opts: SingleCommitOptions,
  session?: HistoryCaptureSession,
): Promise<SnapshotEntry> {
  const { projectRoot, config, sha, shortSha, onStage } = opts;
  const wtDir = session?.wtDir ?? path.join(worktreesRoot(projectRoot), shortSha);
  fs.mkdirSync(worktreesRoot(projectRoot), { recursive: true });

  // --- 1. Get the source onto disk -------------------------------------
  onStage?.('checkout');
  if (session?.initialized) {
    checkoutWorktree(wtDir, sha);
  } else {
    removeWorktree(projectRoot, wtDir);
    rmDirResilient(wtDir);
    addWorktree(projectRoot, wtDir, sha);
    if (session) session.initialized = true;
  }

  // If the boot-significant files (lockfile/config) changed, the running
  // server both must be restarted AND must not hold node_modules while we
  // reinstall — otherwise `npm install` collides with the live dev server's
  // file locks and fails instantly. Stop it BEFORE the install step.
  const signature = computeServerSignature(wtDir);
  if (session && session.server && session.serverSignature !== signature) {
    await session.server.stop().catch(() => {});
    session.server = null;
  }

  // --- 2. Dependencies (reuse when the lockfile is unchanged) -----------
  const useCache = config.installCache !== false;
  const cacheKey = useCache ? computeCacheKey(wtDir) : { hash: null, lockfile: null };
  let restored = false;
  if (
    session &&
    cacheKey.hash &&
    session.dependencyHash === cacheKey.hash &&
    fs.existsSync(path.join(wtDir, 'node_modules'))
  ) {
    restored = true;
    onStage?.('install-reuse', cacheKey.lockfile ?? 'package.json');
  } else if (useCache && cacheKey.hash) {
    const res = restoreFromCache(projectRoot, wtDir, cacheKey);
    if (res.hit) {
      restored = true;
      onStage?.(
        'install-cache-hit',
        `${cacheKey.lockfile ?? 'package.json'} (${formatBytes(res.size)})`,
      );
    }
  }

  if (!restored) {
    onStage?.('install', config.installCommand);
    try {
      execSync(config.installCommand!, { cwd: wtDir, stdio: 'pipe' });
    } catch (err) {
      const stderr =
        (err as { stderr?: Buffer | string }).stderr?.toString?.().trim() ?? '';
      throw new Error(
        `\`${config.installCommand}\` failed${stderr ? `: ${firstLine(stderr)}` : ''}`,
      );
    }
    if (useCache && cacheKey.hash) {
      try {
        persistToCache(projectRoot, wtDir, cacheKey);
      } catch {
        /* non-fatal */
      }
    }
  }
  if (session) session.dependencyHash = cacheKey.hash;

  // --- 3. Server: reuse the running one, or (re)start when required -----
  let activeServer: ManagedServer;
  let ownsServer = false; // standalone mode stops its own server in finally

  if (session) {
    const healthy =
      session.server !== null && (await isReachable(session.server.url, 1500));
    const needStart =
      session.server === null ||
      session.serverSignature !== signature ||
      session.reuseCount >= MAX_REUSE ||
      !healthy;

    if (needStart) {
      if (session.server) {
        await session.server.stop().catch(() => {});
        session.server = null;
      }
      onStage?.('boot');
      session.server = await startServerForWorktree(config, wtDir);
      session.serverSignature = signature;
      session.reuseCount = 0;
    } else {
      onStage?.('reuse');
      session.reuseCount += 1;
      // Let the watcher notice the checkout before we navigate.
      await sleep(RELOAD_SETTLE_MS);
    }
    activeServer = session.server!;
  } else {
    onStage?.('boot');
    activeServer = await startServerForWorktree(config, wtDir);
    ownsServer = true;
  }

  // --- 4. Capture -------------------------------------------------------
  try {
    const git = readCommitMeta(projectRoot, sha);
    const outDir = snapshotDir(projectRoot, sha);
    onStage?.('capture');
    const frames = await captureBundle({
      projectRoot,
      config,
      outDir,
      baseUrl: activeServer.url,
      browser: session?.browser,
    });

    const entry: SnapshotEntry = {
      id: sha,
      source: 'backfill',
      state: 'done',
      git,
      frames,
      capturedAt: new Date().toISOString(),
      stateChangedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(entry, null, 2));
    upsertSnapshot(projectRoot, entry);
    return entry;
  } catch (err) {
    // A capture failure may indicate a wedged server — force a restart next time.
    if (session) session.serverSignature = null;
    throw err;
  } finally {
    if (ownsServer) {
      await activeServer.stop().catch(() => {});
      try {
        removeWorktree(projectRoot, wtDir);
        if (fs.existsSync(wtDir)) fs.rmSync(wtDir, { recursive: true, force: true });
        pruneWorktrees(projectRoot);
      } catch {
        /* noop */
      }
    }
  }
}


/** Remove a directory, retrying on transient ENOTEMPTY/EBUSY; never throws. */
function rmDirResilient(dir: string): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      if (!fs.existsSync(dir)) return;
    } catch {
      /* retry */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function firstLine(s: string): string {
  return s.split('\n').filter((l) => l.trim().length > 0).slice(-1)[0] ?? s;
}
