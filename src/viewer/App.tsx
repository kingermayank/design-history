import React, { useEffect, useMemo, useState } from 'react';
import type { ViewerManifest, ViewerSnapshot, WorkerStatus } from './types.js';
import { SnapshotStage } from './components/SnapshotStage.js';
import { Filters } from './components/Filters.js';
import { EmptyState } from './components/EmptyState.js';
import { WorkerBanner } from './components/WorkerBanner.js';
import { TimeDial } from './components/TimeDial.js';
import { DetailDrawer } from './components/DetailDrawer.js';
import { PagesMap } from './components/PagesMap.js';
import { resolveReferenceFrame } from './lib/resolveReference.js';

const POLL_MS = 2500;

export function App(): React.JSX.Element {
  const [manifest, setManifest] = useState<ViewerManifest | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routePath, setRoutePath] = useState<string | null>(null);
  const [viewport, setViewport] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mode, setMode] = useState<'dial' | 'map'>('dial');

  // Initial + polling fetch.
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch('/api/manifest', { cache: 'no-store' }),
          fetch('/api/state', { cache: 'no-store' }),
        ]);
        if (!mRes.ok) throw new Error(`manifest ${mRes.status}`);
        const m = (await mRes.json()) as ViewerManifest;
        const s = sRes.ok ? ((await sRes.json()) as WorkerStatus) : null;
        if (cancelled) return;
        setManifest(m);
        setWorkerStatus(s);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const routes = useMemo(() => {
    if (!manifest) return [] as string[];
    const set = new Set<string>();
    manifest.snapshots.forEach((s) => s.frames.forEach((f) => set.add(f.routePath)));
    return Array.from(set);
  }, [manifest]);

  const viewports = useMemo(() => {
    if (!manifest) return [] as string[];
    const set = new Set<string>();
    manifest.snapshots.forEach((s) => s.frames.forEach((f) => set.add(f.viewport)));
    return Array.from(set);
  }, [manifest]);

  useEffect(() => {
    if (routePath == null && routes.length > 0) setRoutePath(routes[0] ?? null);
  }, [routes, routePath]);
  useEffect(() => {
    if (viewport == null && viewports.length > 0) {
      setViewport(viewports.includes('desktop') ? 'desktop' : (viewports[0] ?? null));
    }
  }, [viewports, viewport]);

  const byId = useMemo(() => {
    const m = new Map<string, ViewerSnapshot>();
    manifest?.snapshots.forEach((s) => m.set(s.id, s));
    return m;
  }, [manifest]);

  // Show every commit in the timeline. Route/viewport filters apply to the
  // EFFECTIVE frame the commit will display — which for a skipped commit is
  // the resolved reference frame.
  const filtered: ViewerSnapshot[] = useMemo(() => {
    if (!manifest) return [];
    const q = search.trim().toLowerCase();
    return manifest.snapshots.filter((s) => {
      const effective =
        s.state === 'skipped' ? resolveReferenceFrame(s, byId) ?? s : s;
      if (effective.frames.length > 0) {
        if (routePath && !effective.frames.some((f) => f.routePath === routePath)) return false;
        if (viewport && !effective.frames.some((f) => f.viewport === viewport)) return false;
      }
      if (q) {
        const hay = `${s.git.message} ${s.git.author} ${s.git.shortSha} ${s.label ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [manifest, routePath, viewport, search, byId]);

  useEffect(() => {
    if (filtered.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !filtered.some((s) => s.id === activeId)) {
      // Default to the most recent commit that resolves to something showable
      // (done frame, or skipped → done via reference chain).
      const lastShowable = [...filtered].reverse().find((s) => {
        if (s.state === 'done') return true;
        if (s.state === 'skipped') return resolveReferenceFrame(s, byId) !== null;
        return false;
      });
      setActiveId(lastShowable?.id ?? filtered[filtered.length - 1]!.id);
    }
  }, [filtered, activeId]);

  const active = useMemo(
    () => filtered.find((s) => s.id === activeId) ?? null,
    [filtered, activeId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      const idx = filtered.findIndex((s) => s.id === active.id);
      if (idx < 0) return;
      if (e.key === 'ArrowLeft' && idx > 0) {
        setActiveId(filtered[idx - 1]!.id);
      } else if (e.key === 'ArrowRight' && idx < filtered.length - 1) {
        setActiveId(filtered[idx + 1]!.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, active]);

  const prioritize = async (sha: string): Promise<void> => {
    try {
      await fetch('/api/prioritize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha }),
      });
    } catch {
      /* swallow — worst case the user clicks again */
    }
  };

  if (error && !manifest) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Could not load history</h1>
          <p className="text-neutral-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-500 text-sm">
        Loading…
      </div>
    );
  }

  const totalSnapshots = manifest.snapshots.length;
  const showEmpty = totalSnapshots === 0;

  return (
    <div className="flex h-full flex-col">
      <Header
        projectName={manifest.projectName}
        total={totalSnapshots}
        shown={filtered.length}
        workerStatus={workerStatus}
        onToggleDetails={() => setDetailsOpen((v) => !v)}
        detailsOpen={detailsOpen}
        canShowDetails={!!active}
        mode={mode}
        onMode={setMode}
      />
      {workerStatus && <WorkerBanner status={workerStatus} />}
      <Filters
        routes={routes}
        viewports={viewports}
        routePath={routePath}
        viewport={viewport}
        search={search}
        onRoute={setRoutePath}
        onViewport={setViewport}
        onSearch={setSearch}
      />
      <div className="flex flex-1 min-h-0">
        <main className="relative flex-1 min-w-0 flex flex-col">
          {showEmpty ? (
            <EmptyState />
          ) : (
            mode === 'map' ? (
              <PagesMap
                snapshots={filtered}
                viewport={viewport}
                onOpenRoute={(rp) => {
                  setRoutePath(rp);
                  setMode('dial');
                }}
              />
            ) : (
              <>
                <SnapshotStage
                  snapshot={active}
                  routePath={routePath}
                  viewport={viewport}
                  onPrioritize={prioritize}
                  byId={byId}
                />
                <TimeDial
                  snapshots={filtered}
                  activeId={activeId}
                  routePath={routePath}
                  viewport={viewport}
                  byId={byId}
                  onSelect={(id) => {
                    setActiveId(id);
                    const sel = filtered.find((x) => x.id === id);
                    if (sel && (sel.state === 'pending' || sel.state === 'failed')) {
                      void prioritize(id);
                    }
                  }}
                />
              </>
            )
          )}
        </main>
      </div>
      {detailsOpen && <DetailDrawer snapshot={active} onClose={() => setDetailsOpen(false)} />}
    </div>
  );
}

function Header(props: {
  projectName: string;
  total: number;
  shown: number;
  workerStatus: WorkerStatus | null;
  onToggleDetails: () => void;
  detailsOpen: boolean;
  canShowDetails: boolean;
  mode: 'dial' | 'map';
  onMode: (m: 'dial' | 'map') => void;
}): React.JSX.Element {
  const { workerStatus } = props;
  const doneFraction = workerStatus
    ? workerStatus.doneCount / Math.max(1, workerStatus.totalKnown)
    : 1;
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-neutral-900">
      <div className="flex items-center gap-3">
        <div className="h-6 w-6 rounded bg-gradient-to-br from-fuchsia-500 to-amber-400" />
        <div className="flex items-baseline gap-2">
          <span className="font-semibold tracking-tight">design-history</span>
          <span className="text-neutral-500">·</span>
          <span className="text-neutral-300">{props.projectName}</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm tabular-nums">
        <div className="flex items-center rounded-md bg-neutral-900 ring-1 ring-neutral-800 p-0.5 text-xs">
          <button
            onClick={() => props.onMode('dial')}
            className={`px-2.5 py-1 rounded transition ${props.mode === 'dial' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-200'}`}
          >
            Timeline
          </button>
          <button
            onClick={() => props.onMode('map')}
            className={`px-2.5 py-1 rounded transition ${props.mode === 'map' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-200'}`}
          >
            Pages
          </button>
        </div>
        {workerStatus && workerStatus.totalKnown > 0 && (
          <div className="hidden sm:flex items-center gap-2 text-neutral-500">
            <div className="h-1.5 w-32 rounded-full bg-neutral-900 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-fuchsia-500 to-amber-400 transition-all duration-500"
                style={{ width: `${Math.round(doneFraction * 100)}%` }}
              />
            </div>
            <span className="text-neutral-400">
              {workerStatus.doneCount}/{workerStatus.totalKnown}
            </span>
          </div>
        )}
        <div className="text-neutral-500">
          {props.shown === props.total
            ? `${props.total} snapshot${props.total === 1 ? '' : 's'}`
            : `${props.shown} / ${props.total} snapshots`}
        </div>
        <button
          onClick={props.onToggleDetails}
          disabled={!props.canShowDetails}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs ring-1 transition disabled:opacity-30 ${
            props.detailsOpen
              ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-500/30'
              : 'bg-neutral-900 text-neutral-300 ring-neutral-800 hover:bg-neutral-800'
          }`}
          title="Show the code diff and restore this version"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 18l6-6-6-6" />
            <path d="M8 6l-6 6 6 6" />
          </svg>
          Diff &amp; restore
        </button>
      </div>
    </header>
  );
}
