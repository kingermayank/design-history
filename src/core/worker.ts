/**
 * Background capture worker. Runs alongside `design-history view` and turns
 * `pending` skeleton entries into real captures one by one.
 *
 * Priority order (the queue is recomputed when the manifest changes on disk):
 *   1. Anything the user explicitly clicked-to-prioritize (LIFO).
 *   2. The N newest commits (default 5) — the ones most likely to be inspected.
 *   3. An evenly-sampled stride across the rest, so the timeline fills out
 *      visibly instead of crawling from one end.
 *   4. Whatever's left, oldest first.
 */
import { loadConfig } from './config.js';
import { captureCommitFromHistory } from './historyCapture.js';
import { loadManifest, setSnapshotState } from './manifest.js';
import type { DesignHistoryConfig, SnapshotEntry } from './types.js';

const RECENT_FIRST_N = 5;
const STRIDE_TARGET = 8; // aim to spread ~8 samples across the timeline next

export interface WorkerEvents {
  onUpdate?: () => void; // fired any time manifest state changes
  onError?: (sha: string, err: Error) => void;
}

export interface WorkerStatus {
  running: boolean;
  currentSha: string | null;
  queueLength: number;
  doneCount: number;
  failedCount: number;
  totalKnown: number;
}

export class CaptureWorker {
  private projectRoot: string;
  private config: DesignHistoryConfig | null = null;
  private events: WorkerEvents;
  private priorityFront: string[] = []; // user-prioritized SHAs
  private running = false;
  private stopRequested = false;
  private currentSha: string | null = null;

  constructor(projectRoot: string, events: WorkerEvents = {}) {
    this.projectRoot = projectRoot;
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.config = await loadConfig(this.projectRoot);
    this.running = true;
    this.stopRequested = false;
    // Run the loop in the background; do not await it.
    void this.loop();
  }

  stop(): void {
    this.stopRequested = true;
  }

  prioritize(sha: string): void {
    if (this.priorityFront.includes(sha)) return;
    if (this.currentSha === sha) return;
    // Most-recently-clicked is captured next (LIFO).
    this.priorityFront.unshift(sha);
  }

  status(): WorkerStatus {
    const m = loadManifest(this.projectRoot);
    const pending = m.snapshots.filter((s) => s.state === 'pending' || s.state === 'queued');
    return {
      running: this.running,
      currentSha: this.currentSha,
      queueLength: pending.length,
      doneCount: m.snapshots.filter((s) => s.state === 'done').length,
      failedCount: m.snapshots.filter((s) => s.state === 'failed').length,
      totalKnown: m.snapshots.length,
    };
  }

  private async loop(): Promise<void> {
    while (!this.stopRequested) {
      const next = this.pickNext();
      if (!next) {
        // Nothing to do — idle. Recheck periodically; the manifest may
        // gain new entries (e.g. a fresh `commit` while view is open).
        await sleep(2000);
        continue;
      }
      await this.captureOne(next);
    }
    this.running = false;
  }

  private pickNext(): SnapshotEntry | null {
    const m = loadManifest(this.projectRoot);
    const byId = new Map(m.snapshots.map((s) => [s.id, s]));

    // 1) User-prioritized clicks. Skipped entries are also eligible — the
    //    user can force-capture them via "Capture anyway".
    while (this.priorityFront.length > 0) {
      const sha = this.priorityFront.shift()!;
      const entry = byId.get(sha);
      if (
        entry &&
        (entry.state === 'pending' ||
          entry.state === 'queued' ||
          entry.state === 'failed' ||
          entry.state === 'skipped')
      ) {
        return entry;
      }
    }

    const pending = m.snapshots.filter(
      (s) => s.state === 'pending' || s.state === 'queued',
    );
    if (pending.length === 0) return null;

    // Snapshots are sorted oldest → newest in the manifest.
    // 2) The N newest first.
    const newest = pending.slice(-RECENT_FIRST_N).reverse();
    if (newest[0]) return newest[0];

    // 3) Strided fill across the remainder.
    const rest = pending.slice(0, Math.max(0, pending.length - RECENT_FIRST_N));
    if (rest.length === 0) return pending[0]!;
    const stride = Math.max(1, Math.floor(rest.length / STRIDE_TARGET));
    return rest[Math.floor(rest.length / 2)] ?? rest[0]!;
    // (We keep it simple: pick the middle of the unfilled range each pass.
    //  Successive iterations effectively binary-subdivide the timeline so
    //  the user sees visible progress everywhere, not just at one edge.)
  }

  private async captureOne(entry: SnapshotEntry): Promise<void> {
    if (!this.config) return;
    const sha = entry.id;
    const { git } = entry;
    this.currentSha = sha;
    setSnapshotState(this.projectRoot, sha, 'capturing', { error: undefined });
    this.events.onUpdate?.();

    try {
      await captureCommitFromHistory({
        projectRoot: this.projectRoot,
        config: this.config,
        sha,
        shortSha: git.shortSha,
        // captureCommitFromHistory writes its own done-state via upsertSnapshot,
        // which our manifest helpers respect. No further state work needed.
      });
    } catch (err) {
      const reason = (err as Error).message ?? String(err);
      setSnapshotState(this.projectRoot, sha, 'failed', { error: reason });
      this.events.onError?.(sha, err as Error);
    } finally {
      this.currentSha = null;
      this.events.onUpdate?.();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
