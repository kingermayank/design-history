export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface RouteConfig {
  path: string;
  label?: string;
  requiresAuth?: boolean;
  waitFor?: string | number;
}

export interface BackfillConfig {
  maxConcurrentWorktrees?: number;
  skipMergeCommits?: boolean;
}

export interface SkipPatternsConfig {
  /** Files matching ANY of these patterns are considered non-visual. */
  patterns?: string[];
  /** Patterns to add on top of the defaults. */
  extend?: string[];
  /** Patterns to remove from the defaults. */
  remove?: string[];
  /** If false, never skip — capture every commit. Defaults to true. */
  enabled?: boolean;
}

export interface DesignHistoryConfig {
  devServer: string;
  routes: RouteConfig[];
  viewports: ViewportConfig[];
  waitFor?: 'networkidle' | 'load' | 'domcontentloaded' | string | number;
  installCommand?: string;
  startCommand?: string;
  serverReadyTimeoutMs?: number;
  backfill?: BackfillConfig;
  /** Reuse node_modules across commits with identical lockfiles. Default true. */
  installCache?: boolean;
  /** Skip commits whose diff is entirely non-visual. Default true. */
  skip?: SkipPatternsConfig;
}

export interface GitMeta {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  branch: string;
  isoTime: string;
}

export type FrameSource = 'live' | 'backfill' | 'snap';

/**
 * `pending`   — known commit (from git log), not yet captured.
 * `queued`    — explicitly prioritized; up next.
 * `capturing` — worker is actively rendering this commit right now.
 * `done`      — frames exist on disk.
 * `failed`    — capture attempted; error stored in `error`.
 * `skipped`   — diff was entirely non-visual (docs/tests/lockfile); reuses
 *               the prior commit's frames via `referenceFrame`.
 */
export type CaptureState =
  | 'pending'
  | 'queued'
  | 'capturing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface SnapshotFrame {
  routePath: string;
  routeLabel: string;
  viewport: string;
  file: string;
  width: number;
  height: number;
}

export interface SnapshotEntry {
  id: string;
  source: FrameSource;
  state: CaptureState;
  git: GitMeta;
  frames: SnapshotFrame[];
  label?: string;
  capturedAt?: string;
  error?: string;
  /** ISO timestamp of last state change — drives "capturing for 12s" UI. */
  stateChangedAt?: string;
  /** For `skipped` entries: the id of the prior snapshot whose frames to display. */
  referenceFrame?: string;
  /** Human-readable reason this commit was skipped (paths that drove the decision). */
  skipReason?: string;
}

export interface Manifest {
  version: 1;
  projectName: string;
  createdAt: string;
  snapshots: SnapshotEntry[];
}
