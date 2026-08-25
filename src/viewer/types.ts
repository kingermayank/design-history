export interface ViewerFrame {
  routePath: string;
  routeLabel: string;
  viewport: string;
  file: string;
  thumb?: string;
  width: number;
  height: number;
}

export interface ViewerGitMeta {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  authorEmail: string;
  branch: string;
  isoTime: string;
}

export type ViewerCaptureState =
  | 'pending'
  | 'queued'
  | 'capturing'
  | 'done'
  | 'failed'
  | 'skipped';

export interface ViewerSnapshot {
  id: string;
  source: 'live' | 'backfill' | 'snap';
  state: ViewerCaptureState;
  git: ViewerGitMeta;
  frames: ViewerFrame[];
  label?: string;
  capturedAt?: string;
  error?: string;
  stateChangedAt?: string;
  referenceFrame?: string;
  skipReason?: string;
}

export interface WorkerStatus {
  running: boolean;
  currentSha: string | null;
  queueLength: number;
  doneCount: number;
  failedCount: number;
  totalKnown: number;
}

export interface ViewerManifest {
  version: 1;
  projectName: string;
  createdAt: string;
  snapshots: ViewerSnapshot[];
}
