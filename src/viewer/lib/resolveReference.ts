import type { ViewerSnapshot } from '../types.js';

/**
 * For a `skipped` snapshot, walk the referenceFrame chain to find the nearest
 * snapshot that actually has frames (`state === 'done'`). Returns null if no
 * such snapshot exists yet (e.g. nothing has been captured before this one).
 */
export function resolveReferenceFrame(
  snapshot: ViewerSnapshot,
  byId: Map<string, ViewerSnapshot>,
): ViewerSnapshot | null {
  let cur: ViewerSnapshot | undefined = snapshot;
  const seen = new Set<string>();
  while (cur) {
    if (cur.state === 'done' && cur.frames.length > 0) return cur;
    if (cur.state !== 'skipped' || !cur.referenceFrame) return null;
    if (seen.has(cur.id)) return null; // cycle protection
    seen.add(cur.id);
    cur = byId.get(cur.referenceFrame);
  }
  return null;
}
