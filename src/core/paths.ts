import path from 'node:path';

export const HISTORY_DIR = '.design-history';
export const SNAPSHOTS_DIR = 'snapshots';
export const WORKTREES_DIR = '.worktrees';
export const CACHE_DIR = '.cache';
export const NODE_MODULES_CACHE_DIR = 'node_modules';
export const MANIFEST_FILE = 'manifest.json';
export const AUTH_FILE = 'auth.json';
export const SKIPPED_LOG = 'skipped.log';
export const BACKFILL_LOG = 'backfill-skipped.log';
export const BACKFILL_STATE = 'backfill-state.json';
export const CONFIG_FILE = 'design-history.config.js';

export function historyRoot(projectRoot: string): string {
  return path.join(projectRoot, HISTORY_DIR);
}

export function snapshotsRoot(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), SNAPSHOTS_DIR);
}

export function snapshotDir(projectRoot: string, id: string): string {
  return path.join(snapshotsRoot(projectRoot), id);
}

export function manifestPath(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), MANIFEST_FILE);
}

export function authPath(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), AUTH_FILE);
}

export function worktreesRoot(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), WORKTREES_DIR);
}

export function cacheRoot(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), CACHE_DIR);
}

export function nodeModulesCacheDir(projectRoot: string, lockHash: string): string {
  return path.join(cacheRoot(projectRoot), NODE_MODULES_CACHE_DIR, lockHash);
}

export function skippedLogPath(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), SKIPPED_LOG);
}

export function backfillLogPath(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), BACKFILL_LOG);
}

export function backfillStatePath(projectRoot: string): string {
  return path.join(historyRoot(projectRoot), BACKFILL_STATE);
}

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_FILE);
}
