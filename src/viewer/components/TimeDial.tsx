import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ViewerSnapshot } from '../types.js';
import { resolveReferenceFrame } from '../lib/resolveReference.js';

interface Props {
  snapshots: ViewerSnapshot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  routePath: string | null;
  viewport: string | null;
  byId: Map<string, ViewerSnapshot>;
}

const THUMB_W = 60;
const THUMB_H = 40;
const GAP = 8;
const SPACING = THUMB_W + GAP;

/**
 * A floating "radio dial" scrubber whose ruler IS the timeline: each tick is the
 * snapshot's own thumbnail. Drag to travel through time (the stage updates live
 * as thumbnails pass under the needle), or click any thumbnail to jump to it.
 */
export function TimeDial(props: Props): React.JSX.Element | null {
  const { snapshots, activeId, onSelect, routePath, viewport, byId } = props;
  const [drag, setDrag] = useState<{ startX: number; baseIndex: number; dx: number } | null>(
    null,
  );
  const movedRef = useRef(false);

  const n = snapshots.length;
  const activeIndex = useMemo(() => {
    const i = snapshots.findIndex((s) => s.id === activeId);
    return i < 0 ? n - 1 : i;
  }, [snapshots, activeId, n]);

  const clampIndex = useCallback((i: number) => Math.max(0, Math.min(n - 1, i)), [n]);
  const floatIndex = drag ? clampIndex(drag.baseIndex - drag.dx / SPACING) : activeIndex;

  const thumbFor = useCallback(
    (s: ViewerSnapshot): string | null => {
      const eff = s.state === 'skipped' ? resolveReferenceFrame(s, byId) ?? s : s;
      const frame = eff.frames.find(
        (f) => (!routePath || f.routePath === routePath) && (!viewport || f.viewport === viewport),
      );
      if (!frame) return null;
      const name = frame.thumb ?? frame.file;
      return `/data/snapshots/${encodeURIComponent(eff.id)}/${encodeURIComponent(name)}`;
    },
    [byId, routePath, viewport],
  );

  const step = useCallback(
    (dir: -1 | 1) => {
      const s = snapshots[clampIndex(activeIndex + dir)];
      if (s) onSelect(s.id);
    },
    [activeIndex, clampIndex, snapshots, onSelect],
  );

  const onPointerDown = (e: React.PointerEvent): void => {
    movedRef.current = false;
    setDrag({ startX: e.clientX, baseIndex: activeIndex, dx: 0 });
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 4) movedRef.current = true;
    setDrag({ ...drag, dx });
    const rounded = clampIndex(Math.round(drag.baseIndex - dx / SPACING));
    if (rounded !== activeIndex) {
      const s = snapshots[rounded];
      if (s) onSelect(s.id);
    }
  };
  const endDrag = (): void => {
    if (!drag) return;
    const rounded = clampIndex(Math.round(drag.baseIndex - drag.dx / SPACING));
    const s = snapshots[rounded];
    if (s) onSelect(s.id);
    setDrag(null);
  };

  if (n === 0) return null;

  const centered = snapshots[clampIndex(Math.round(floatIndex))] ?? snapshots[activeIndex]!;
  const date = new Date(centered.git.isoTime);
  const activeCenterPx = floatIndex * SPACING + THUMB_W / 2;
  const trackTranslate = `translate(-${activeCenterPx}px, -50%)`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-[min(760px,94vw)] rounded-2xl border border-white/10 bg-neutral-900/70 backdrop-blur-xl shadow-2xl shadow-black/50 select-none">
        {/* readout */}
        <div className="flex items-center gap-3 px-4 pt-3">
          <button
            onClick={() => step(-1)}
            disabled={activeIndex <= 0}
            aria-label="Previous version"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-30"
          >
            <Chevron dir="left" />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div className="flex items-center justify-center gap-2 text-[15px] font-semibold tracking-tight text-neutral-50">
              <StateDot state={centered.state} />
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              <span className="font-mono text-[11px] font-normal text-neutral-500">
                {centered.git.shortSha}
              </span>
            </div>
            <div className="truncate text-[11px] leading-tight text-neutral-400">
              {centered.git.message}
            </div>
          </div>

          <button
            onClick={() => step(1)}
            disabled={activeIndex >= n - 1}
            aria-label="Next version"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 text-neutral-300 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-30"
          >
            <Chevron dir="right" />
          </button>
        </div>

        {/* thumbnail filmstrip ruler */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`relative mx-3 mt-2 mb-3 overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/5 ${
            drag ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{ height: THUMB_H + 22, touchAction: 'none' }}
        >
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-neutral-900/90 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-neutral-900/90 to-transparent" />

          {/* center needle */}
          <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-full -translate-x-1/2">
            <div className="mx-auto h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-accent-400" />
          </div>

          {/* thumbnails */}
          <div
            className="absolute left-1/2 top-1/2 flex items-center"
            style={{
              transform: trackTranslate,
              transition: drag ? 'none' : 'transform 260ms cubic-bezier(0.22,1,0.36,1)',
              gap: GAP,
            }}
          >
            {snapshots.map((s, i) => {
              const isActive = i === Math.round(floatIndex);
              const src = thumbFor(s);
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (movedRef.current) return; // was a drag, not a tap
                    onSelect(s.id);
                  }}
                  title={`${s.git.shortSha} — ${s.git.message}`}
                  className={`relative shrink-0 overflow-hidden rounded-md ring-1 transition-all ${
                    isActive
                      ? 'ring-2 ring-accent-400 shadow-lg shadow-accent-500/25'
                      : 'ring-white/10 opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    width: THUMB_W,
                    height: THUMB_H,
                    transform: isActive ? 'scale(1.12)' : 'scale(1)',
                  }}
                >
                  {src ? (
                    <img src={src} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
                  ) : (
                    <ThumbPlaceholder snapshot={s} />
                  )}
                  {s.state === 'skipped' && (
                    <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 font-mono text-[8px] text-neutral-300">
                      =
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pb-2 text-center text-[10px] font-mono tabular-nums text-neutral-600">
          {clampIndex(Math.round(floatIndex)) + 1} / {n} · drag or click to travel through time
        </div>
      </div>
    </div>
  );
}

function ThumbPlaceholder({ snapshot }: { snapshot: ViewerSnapshot }): React.JSX.Element {
  const bg =
    snapshot.state === 'capturing'
      ? 'bg-accent-500/20'
      : snapshot.state === 'failed'
        ? 'bg-amber-500/15'
        : 'bg-neutral-800';
  return (
    <div className={`grid h-full w-full place-items-center ${bg}`}>
      <span className="font-mono text-[8px] text-neutral-400">{snapshot.git.shortSha.slice(0, 5)}</span>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  );
}

function StateDot({ state }: { state: ViewerSnapshot['state'] }): React.JSX.Element {
  const color =
    state === 'done'
      ? 'bg-emerald-400'
      : state === 'skipped'
        ? 'bg-neutral-500'
        : state === 'failed'
          ? 'bg-amber-400'
          : 'bg-accent-400';
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${color}`} />;
}
