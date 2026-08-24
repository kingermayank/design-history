/**
 * Build a skeleton manifest from `git log` so the viewer can show every commit
 * immediately, even before any frames have been captured.
 *
 * Merges with the on-disk manifest: existing entries (`done`, `failed`,
 * `capturing`, `skipped`) always win over a freshly-derived `pending`
 * placeholder, so progress survives a restart of `view`.
 *
 * v0.3 addition: commits whose diff is entirely non-visual are marked
 * `skipped` at skeleton-build time. The worker never tries to capture them;
 * the viewer falls back to the immediately-prior frame via `referenceFrame`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listCommits, readCommitMeta } from './git.js';
import { loadManifest, writeManifest } from './manifest.js';
import { snapshotDir } from './paths.js';
import { buildPatternSet, shouldSkipCommit } from './skipPatterns.js';
import type { DesignHistoryConfig, Manifest, SnapshotEntry } from './types.js';

export interface BuildSkeletonOptions {
  projectRoot: string;
  config: DesignHistoryConfig;
  /** Cap how many commits we expose. Default: all of them. */
  limit?: number;
  /** Git branch or revision to enumerate. Default: HEAD. */
  branch?: string;
}

export function buildSkeletonManifest(opts: BuildSkeletonOptions): Manifest {
  const { projectRoot, config, limit, branch } = opts;
  const existing = loadManifest(projectRoot);
  const byId = new Map(existing.snapshots.map((s) => [s.id, s]));

  const commits = listCommits(projectRoot, {
    branch,
    limit,
    skipMerges: config.backfill?.skipMergeCommits ?? true,
  });

  const skipEnabled = config.skip?.enabled ?? true;
  const patterns = skipEnabled ? buildPatternSet(config.skip) : [];

  const merged: SnapshotEntry[] = commits.map((c, idx) => {
    const prior = byId.get(c.sha);
    if (prior) return reviveEntry(projectRoot, prior);

    const git = readCommitMeta(projectRoot, c.sha);
    // We walk listCommits' chronological order. For simple linear histories
    // (the common case), commits[idx-1] IS the parent of commits[idx]. For
    // complex branching after skipMerges, this may be a slight approximation;
    // the worst case is a false negative (we capture something we didn't have
    // to), never a false positive.
    const parentSha = idx > 0 ? commits[idx - 1]!.sha : null;

    if (skipEnabled) {
      const decision = shouldSkipCommit(projectRoot, c.sha, parentSha, patterns);
      if (decision.skip) {
        return {
          id: c.sha,
          source: 'backfill',
          state: 'skipped',
          git,
          frames: [],
          referenceFrame: parentSha ?? undefined,
          skipReason: decision.reason,
          stateChangedAt: new Date().toISOString(),
        };
      }
    }

    return {
      id: c.sha,
      source: 'backfill',
      state: 'pending',
      git,
      frames: [],
      stateChangedAt: new Date().toISOString(),
    };
  });

  // Preserve any snapshots whose ids aren't in `git log` (e.g. manual `snap`s
  // with synthetic ids, or commits filtered out by skipMerges).
  for (const s of existing.snapshots) {
    if (!commits.some((c) => c.sha === s.id) && !merged.some((m) => m.id === s.id)) {
      merged.push(reviveEntry(projectRoot, s));
    }
  }

  merged.sort((a, b) => a.git.isoTime.localeCompare(b.git.isoTime));

  const next: Manifest = {
    version: 1,
    projectName: existing.projectName || path.basename(projectRoot),
    createdAt: existing.createdAt || new Date().toISOString(),
    snapshots: merged,
  };

  writeManifest(projectRoot, next);
  return next;
}

/**
 * Sanity-check an existing entry on startup:
 *   - `capturing` from a previous dead worker → reset to `pending`.
 *   - `done` but frame files missing on disk → reset to `pending`.
 *   - `skipped` survives untouched (cheap to keep).
 */
function reviveEntry(projectRoot: string, entry: SnapshotEntry): SnapshotEntry {
  if (entry.state === 'capturing') {
    return { ...entry, state: 'pending', stateChangedAt: new Date().toISOString() };
  }
  if (entry.state === 'done' && entry.frames.length > 0) {
    const dir = snapshotDir(projectRoot, entry.id);
    const allPresent = entry.frames.every((f) => fs.existsSync(path.join(dir, f.file)));
    if (!allPresent) {
      return {
        ...entry,
        state: 'pending',
        frames: [],
        stateChangedAt: new Date().toISOString(),
      };
    }
  }
  return entry;
}
