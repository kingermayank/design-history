import React, { useMemo } from 'react';
import type { ViewerSnapshot } from '../types.js';

interface RouteSummary {
  path: string;
  label: string;
  versions: number;
  firstIso: string;
  lastIso: string;
  thumbSrc: string | null;
  width: number;
  height: number;
}

interface Props {
  snapshots: ViewerSnapshot[];
  viewport: string | null;
  onOpenRoute: (routePath: string) => void;
}

/**
 * A route-first view: every captured page as a card (latest thumbnail, version
 * count, date range). Click a page to drop into the dial scoped to that route.
 */
export function PagesMap({ snapshots, viewport, onOpenRoute }: Props): React.JSX.Element {
  const routes = useMemo(() => {
    const map = new Map<string, RouteSummary>();
    // snapshots arrive oldest → newest, so the last write wins for "latest".
    for (const s of snapshots) {
      if (s.state !== 'done' || s.frames.length === 0) continue;
      const seen = new Set<string>();
      for (const f of s.frames) {
        if (seen.has(f.routePath)) continue;
        seen.add(f.routePath);
        // Prefer the requested viewport for the card image.
        const frame =
          s.frames.find((g) => g.routePath === f.routePath && (!viewport || g.viewport === viewport)) ??
          f;
        const thumbSrc = `/data/snapshots/${encodeURIComponent(s.id)}/${encodeURIComponent(
          frame.thumb ?? frame.file,
        )}`;
        const existing = map.get(f.routePath);
        if (!existing) {
          map.set(f.routePath, {
            path: f.routePath,
            label: frame.routeLabel || f.routePath,
            versions: 1,
            firstIso: s.git.isoTime,
            lastIso: s.git.isoTime,
            thumbSrc,
            width: frame.width,
            height: frame.height,
          });
        } else {
          existing.versions += 1;
          existing.lastIso = s.git.isoTime;
          existing.thumbSrc = thumbSrc;
          existing.width = frame.width;
          existing.height = frame.height;
        }
      }
    }
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }, [snapshots, viewport]);

  if (routes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
        No captured pages yet.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 max-w-[1200px] mx-auto">
        {routes.map((r) => (
          <button
            key={r.path}
            onClick={() => onOpenRoute(r.path)}
            className="group text-left rounded-xl overflow-hidden bg-neutral-900 ring-1 ring-neutral-800 hover:ring-fuchsia-500/50 transition fade-in"
          >
            <div className="aspect-[16/10] bg-neutral-950 overflow-hidden relative">
              {r.thumbSrc ? (
                <img
                  src={r.thumbSrc}
                  alt=""
                  className="w-full h-full object-cover object-top opacity-90 group-hover:opacity-100 transition"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full grid place-items-center text-neutral-700 text-xs">
                  no capture
                </div>
              )}
              <span className="absolute top-2 right-2 rounded-full bg-black/60 backdrop-blur px-2 py-0.5 text-[10px] font-mono text-neutral-200">
                {r.versions} version{r.versions === 1 ? '' : 's'}
              </span>
            </div>
            <div className="px-3 py-2.5">
              <div className="font-mono text-[12px] text-neutral-200 truncate">{r.path}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500 tabular-nums">
                {fmt(r.firstIso)}{r.firstIso !== r.lastIso ? ` – ${fmt(r.lastIso)}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}
