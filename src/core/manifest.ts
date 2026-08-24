import fs from 'node:fs';
import path from 'node:path';
import type { CaptureState, Manifest, SnapshotEntry } from './types.js';
import { manifestPath, historyRoot } from './paths.js';

export function loadManifest(projectRoot: string): Manifest {
  const file = manifestPath(projectRoot);
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      projectName: path.basename(projectRoot),
      createdAt: new Date().toISOString(),
      snapshots: [],
    };
  }
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw) as Manifest;
  } catch {
    throw new Error(`Could not parse ${file}. File may be corrupt.`);
  }
}

export function writeManifest(projectRoot: string, manifest: Manifest): void {
  fs.mkdirSync(historyRoot(projectRoot), { recursive: true });
  const file = manifestPath(projectRoot);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function upsertSnapshot(projectRoot: string, entry: SnapshotEntry): Manifest {
  const m = loadManifest(projectRoot);
  const idx = m.snapshots.findIndex((s) => s.id === entry.id);
  if (idx >= 0) {
    m.snapshots[idx] = entry;
  } else {
    m.snapshots.push(entry);
  }
  m.snapshots.sort((a, b) => a.git.isoTime.localeCompare(b.git.isoTime));
  writeManifest(projectRoot, m);
  return m;
}

export function hasSnapshot(projectRoot: string, id: string): boolean {
  const m = loadManifest(projectRoot);
  return m.snapshots.some((s) => s.id === id);
}

export function hasDoneSnapshot(projectRoot: string, id: string): boolean {
  const m = loadManifest(projectRoot);
  return m.snapshots.some((s) => s.id === id && s.state === 'done');
}

export function setSnapshotState(
  projectRoot: string,
  id: string,
  state: CaptureState,
  patch: Partial<SnapshotEntry> = {},
): void {
  const m = loadManifest(projectRoot);
  const idx = m.snapshots.findIndex((s) => s.id === id);
  if (idx < 0) return;
  m.snapshots[idx] = {
    ...m.snapshots[idx]!,
    ...patch,
    state,
    stateChangedAt: new Date().toISOString(),
  };
  writeManifest(projectRoot, m);
}
