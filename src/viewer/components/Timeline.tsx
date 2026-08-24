import React, { useEffect, useRef } from 'react';
import type { ViewerSnapshot } from '../types.js';
import { resolveReferenceFrame } from '../lib/resolveReference.js';

interface Props {
  snapshots: ViewerSnapshot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  routePath: string | null;
  viewport: string | null;
  currentlyCapturingSha: string | null;
  byId: Map<string, ViewerSnapshot>;
}

export function Timeline(props: Props): React.JSX.Element {
  const {
    snapshots,
    activeId,
    onSelect,
    routePath,
    viewport,
    currentlyCapturingSha,
    byId,
  } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !activeId) return;
    const el = ref.current.querySelector<HTMLElement>(`[data-id="${activeId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeId]);

  if (snapshots.length === 0) {
    return (
      <div className="px-5 py-4 border-t border-neutral-900 text-xs text-neutral-600 text-center">
        No snapshots match the current filters.
      </div>
    );
  }

  return (
    <div className="border-t border-neutral-900 bg-neutral-950">
      <div ref={ref} className="timeline-scroll overflow-x-auto overflow-y-hidden px-5 py-4">
        <div className="flex items-end gap-3 min-w-max">
          {snapshots.map((s, i) => {
            // For skipped commits, render the resolved reference frame thumbnail.
            const effective: ViewerSnapshot =
              s.state === 'skipped'
                ? (resolveReferenceFrame(s, byId) ?? s)
                : s;
            const frame = effective.frames.find(
              (f) =>
                (!routePath || f.routePath === routePath) &&
                (!viewport || f.viewport === viewport),
            );
            const isActive = s.id === activeId;
            const isCapturingNow = s.id === currentlyCapturingSha;
            const src = frame
              ? `/data/snapshots/${encodeURIComponent(effective.id)}/${encodeURIComponent(frame.file)}`
              : null;

            return (
              <button
                key={s.id}
                data-id={s.id}
                onClick={() => onSelect(s.id)}
                title={`${s.git.shortSha} — ${s.git.message}${
                  s.state === 'pending'
                    ? ' · click to capture next'
                    : s.state === 'failed'
                      ? ' · click to retry'
                      : ''
                }`}
                className={`group relative shrink-0 rounded-md overflow-hidden transition ring-1 ${
                  isActive
                    ? 'ring-fuchsia-400 shadow-lg shadow-fuchsia-500/20 scale-[1.02]'
                    : isCapturingNow
                      ? 'ring-fuchsia-500/60 animate-pulse'
                      : 'ring-neutral-800 hover:ring-neutral-600'
                }`}
                style={{ width: 96, height: 64 }}
              >
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className="w-full h-full object-cover object-top opacity-90 group-hover:opacity-100 transition"
                    loading="lazy"
                  />
                ) : (
                  <Placeholder snapshot={s} />
                )}

                <div className="absolute bottom-0 inset-x-0 px-1 py-0.5 bg-gradient-to-t from-black/80 to-transparent text-[9px] font-mono text-neutral-200 text-left">
                  {s.git.shortSha}
                </div>

                <StateBadge snapshot={s} isCapturingNow={isCapturingNow} />

                {i === 0 && (
                  <span className="absolute top-1 left-1 text-[9px] uppercase tracking-wider text-neutral-300 bg-black/40 backdrop-blur px-1 rounded">
                    start
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="px-5 pb-3 flex items-center justify-between text-[11px] text-neutral-600 font-mono tabular-nums">
        <span>{shortDate(snapshots[0]!.git.isoTime)}</span>
        <span className="text-neutral-700">← → to scrub · click pending to capture next</span>
        <span>{shortDate(snapshots[snapshots.length - 1]!.git.isoTime)}</span>
      </div>
    </div>
  );
}

function Placeholder({ snapshot }: { snapshot: ViewerSnapshot }): React.JSX.Element {
  const bgByState: Record<string, string> = {
    pending: 'bg-neutral-900',
    queued: 'bg-fuchsia-500/[0.08]',
    capturing: 'bg-fuchsia-500/[0.12]',
    failed: 'bg-amber-500/[0.06]',
    done: 'bg-neutral-900',
    skipped: 'bg-neutral-900',
  };
  return (
    <div
      className={`w-full h-full ${bgByState[snapshot.state] ?? 'bg-neutral-900'} flex flex-col items-center justify-center px-1 text-center`}
    >
      <div className="text-[10px] text-neutral-400 leading-tight line-clamp-2 break-words">
        {truncate(snapshot.git.message, 36)}
      </div>
    </div>
  );
}

function StateBadge({
  snapshot,
  isCapturingNow,
}: {
  snapshot: ViewerSnapshot;
  isCapturingNow: boolean;
}): React.JSX.Element | null {
  if (snapshot.state === 'done' && snapshot.source === 'backfill') {
    return (
      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-neutral-950" />
    );
  }
  if (isCapturingNow || snapshot.state === 'capturing') {
    return (
      <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-fuchsia-400 ring-2 ring-neutral-950 animate-pulse" />
    );
  }
  if (snapshot.state === 'failed') {
    return (
      <span
        className="absolute top-1 right-1 inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-amber-500/90 text-[10px] font-bold text-neutral-950"
        title={snapshot.error ?? 'capture failed'}
      >
        !
      </span>
    );
  }
  if (snapshot.state === 'queued') {
    return (
      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-fuchsia-300 ring-2 ring-neutral-950" />
    );
  }
  if (snapshot.state === 'skipped') {
    return (
      <span
        className="absolute top-1 right-1 inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-neutral-700/90 text-[9px] font-bold text-neutral-300 font-mono"
        title={snapshot.skipReason ?? 'non-visual change, skipped'}
      >
        =
      </span>
    );
  }
  return null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
