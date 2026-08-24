/**
 * Lockfile-keyed node_modules cache.
 *
 * Across a 66-commit history, the lockfile usually changes only a handful of
 * times. Running `npm install` 66 times is wasted work; we hash whichever
 * lockfile exists and reuse a previously-installed node_modules tree if we've
 * seen the same hash before.
 *
 * Storage: `.design-history/.cache/node_modules/<sha1-of-lockfile>/`.
 * Restore: macOS / Linux use `cp -al` to hardlink the tree into the worktree
 * (near-instant, no extra disk). Symlinks would be even faster, but a few
 * bundlers and dependency-init scripts resolve them in surprising ways.
 *
 * False-hit safety: we only restore if both the lockfile AND the package.json
 * match. If a dev edited node_modules manually, that's their problem.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { nodeModulesCacheDir, cacheRoot } from './paths.js';

const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
];

export interface CacheKey {
  /** sha1(lockfile + package.json). null if neither exists. */
  hash: string | null;
  /** Which lockfile we hashed (for logging). null if we fell back to package.json only. */
  lockfile: string | null;
}


/**
 * Copy a directory tree fast and SAFELY. Prefers APFS copy-on-write clones
 * (`cp -c`), which share storage like a hardlink but are copy-on-write, so
 * writes into the destination (e.g. Vite's node_modules/.vite cache) never
 * corrupt the shared source. Falls back to a plain recursive copy.
 *
 * We deliberately do NOT use hardlinks (`cp -al`): with hardlinks the worktree
 * and the cache share the same inodes, so a running dev server mutates the
 * cache and later restores hand back a corrupted node_modules.
 */
function cloneTree(src: string, dst: string): boolean {
  // macOS: -c requests clonefile (CoW). -R recursive. -p preserve.
  const clone = spawnSync('cp', ['-cRp', src, dst], { stdio: 'pipe' });
  if (clone.status === 0) return true;
  const plain = spawnSync('cp', ['-Rp', src, dst], { stdio: 'pipe' });
  return plain.status === 0;
}

export function computeCacheKey(worktree: string): CacheKey {
  const lockfile = LOCKFILES.find((f) => fs.existsSync(path.join(worktree, f))) ?? null;
  const pkgPath = path.join(worktree, 'package.json');
  const hasPkg = fs.existsSync(pkgPath);
  if (!lockfile && !hasPkg) return { hash: null, lockfile: null };

  const h = createHash('sha1');
  if (lockfile) h.update(fs.readFileSync(path.join(worktree, lockfile)));
  if (hasPkg) h.update(fs.readFileSync(pkgPath));
  return { hash: h.digest('hex').slice(0, 16), lockfile };
}

export interface RestoreResult {
  hit: boolean;
  /** Bytes occupied by the cache entry (for telemetry). 0 on miss. */
  size: number;
}

/**
 * Try to materialize node_modules in the worktree from the cache.
 * Returns hit=true if successful. On miss, the worktree is left untouched
 * so the caller can run the real install command.
 */
export function restoreFromCache(
  projectRoot: string,
  worktree: string,
  key: CacheKey,
): RestoreResult {
  if (!key.hash) return { hit: false, size: 0 };
  const cacheDir = nodeModulesCacheDir(projectRoot, key.hash);
  if (!fs.existsSync(cacheDir)) return { hit: false, size: 0 };

  const target = path.join(worktree, 'node_modules');
  // Wipe any partial node_modules in the worktree first.
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (!cloneTree(cacheDir, target)) return { hit: false, size: 0 };

  return { hit: true, size: dirSizeApprox(cacheDir) };
}

/**
 * After a successful `npm install`, persist the resulting node_modules to the
 * cache. Idempotent: if the cache entry already exists, leaves it alone.
 */
export function persistToCache(
  projectRoot: string,
  worktree: string,
  key: CacheKey,
): void {
  if (!key.hash) return;
  const nm = path.join(worktree, 'node_modules');
  if (!fs.existsSync(nm)) return;

  const cacheDir = nodeModulesCacheDir(projectRoot, key.hash);
  if (fs.existsSync(cacheDir)) return; // already cached

  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  // Clone (CoW) so the cache is an independent copy — a later dev server writing
  // into the restored tree can never corrupt this cached copy.
  cloneTree(nm, cacheDir);
}

export function clearCache(projectRoot: string): { removed: number } {
  const root = cacheRoot(projectRoot);
  if (!fs.existsSync(root)) return { removed: 0 };
  const size = dirSizeApprox(root);
  fs.rmSync(root, { recursive: true, force: true });
  return { removed: size };
}

/**
 * Cheap directory size estimate: just `du -sk` if available, else best-effort.
 * Used for human-readable logging, not for correctness.
 */
function dirSizeApprox(dir: string): number {
  try {
    const out = execFileSync('du', ['-sk', dir], { encoding: 'utf8' });
    const kb = parseInt(out.split(/\s+/)[0] ?? '0', 10);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
