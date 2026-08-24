import React from 'react';
import type { ViewerSnapshot } from '../types.js';
import { resolveReferenceFrame } from '../lib/resolveReference.js';

interface Props {
  snapshot: ViewerSnapshot | null;
  routePath: string | null;
  viewport: string | null;
  onPrioritize: (sha: string) => void;
  byId: Map<string, ViewerSnapshot>;
}

export function SnapshotStage(props: Props): React.JSX.Element {
  const { snapshot, routePath, viewport, onPrioritize, byId } = props;
  if (!snapshot) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
        Select a snapshot from the timeline below.
      </div>
    );
  }

  if (snapshot.state === 'pending' || snapshot.state === 'queued') {
    return <PendingStage snapshot={snapshot} onPrioritize={onPrioritize} />;
  }
  if (snapshot.state === 'capturing') {
    return <CapturingStage snapshot={snapshot} />;
  }
  if (snapshot.state === 'failed') {
    return <FailedStage snapshot={snapshot} onPrioritize={onPrioritize} />;
  }

  if (snapshot.state === 'skipped') {
    const reference = resolveReferenceFrame(snapshot, byId);
    if (!reference) {
      return <SkippedNoReferenceStage snapshot={snapshot} onPrioritize={onPrioritize} />;
    }
    return (
      <FrameStage
        snapshot={reference}
        routePath={routePath}
        viewport={viewport}
        skippedOriginal={snapshot}
      />
    );
  }

  return (
    <FrameStage snapshot={snapshot} routePath={routePath} viewport={viewport} />
  );
}

function FrameStage(props: {
  snapshot: ViewerSnapshot;
  routePath: string | null;
  viewport: string | null;
  skippedOriginal?: ViewerSnapshot;
}): React.JSX.Element {
  const { snapshot, routePath, viewport, skippedOriginal } = props;
  const frame = snapshot.frames.find(
    (f) => (!routePath || f.routePath === routePath) && (!viewport || f.viewport === viewport),
  );

  if (!frame) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        This commit does not have a frame for {routePath} @ {viewport}.
      </div>
    );
  }

  const src = `/data/snapshots/${encodeURIComponent(snapshot.id)}/${encodeURIComponent(frame.file)}`;

  return (
    <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_60%)]">
      <div className="fade-in inline-block relative rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/5 bg-neutral-900">
        <img
          src={src}
          alt={`${frame.routeLabel} ${frame.viewport}`}
          className="block max-w-[min(1200px,100%)] max-h-[78vh]"
          style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
        />
        {skippedOriginal && (
          <div className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-md bg-black/70 backdrop-blur px-2.5 py-1 text-[11px] text-neutral-200 ring-1 ring-white/10">
            <span className="text-neutral-500 font-mono">=</span>
            <span>
              No visual change since{' '}
              <code className="font-mono text-neutral-300">{snapshot.git.shortSha}</code>
            </span>
            {skippedOriginal.skipReason && (
              <span className="text-neutral-500" title={skippedOriginal.skipReason}>
                · why?
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SkippedNoReferenceStage(props: {
  snapshot: ViewerSnapshot;
  onPrioritize: (sha: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-md text-center fade-in">
        <SkeletonShimmer />
        <div className="mt-6 text-sm text-neutral-400 leading-relaxed">
          design-history considered this commit non-visual (
          {props.snapshot.skipReason ?? 'docs-only / config-only diff'}
          ) but no prior frame has been captured yet to display in its place.
        </div>
        <button
          onClick={() => props.onPrioritize(props.snapshot.id)}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30 px-3 py-1.5 text-xs text-fuchsia-200 hover:bg-fuchsia-500/25"
        >
          Capture anyway →
        </button>
      </div>
    </div>
  );
}

function PendingStage(props: {
  snapshot: ViewerSnapshot;
  onPrioritize: (sha: string) => void;
}): React.JSX.Element {
  const { snapshot } = props;
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-md text-center fade-in">
        <SkeletonShimmer />
        <div className="mt-6 text-sm text-neutral-400 leading-relaxed">
          This commit hasn't been captured yet.
        </div>
        <div className="mt-1 text-xs text-neutral-600 font-mono">
          {snapshot.git.shortSha} · {snapshot.git.message}
        </div>
        <button
          onClick={() => props.onPrioritize(snapshot.id)}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30 px-3 py-1.5 text-xs text-fuchsia-200 hover:bg-fuchsia-500/25"
        >
          Capture next →
        </button>
      </div>
    </div>
  );
}

function CapturingStage(props: { snapshot: ViewerSnapshot }): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-md text-center fade-in">
        <SkeletonShimmer animated />
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-fuchsia-200">
          <span className="inline-block h-2 w-2 rounded-full bg-fuchsia-400 animate-pulse" />
          Capturing now…
        </div>
        <div className="mt-1 text-xs text-neutral-600 font-mono">
          {props.snapshot.git.shortSha} · {props.snapshot.git.message}
        </div>
        <div className="mt-3 text-[11px] text-neutral-600 leading-relaxed">
          Booting the dev server for this commit and screenshotting the configured routes.
          This typically takes 30–90 seconds.
        </div>
      </div>
    </div>
  );
}

function FailedStage(props: {
  snapshot: ViewerSnapshot;
  onPrioritize: (sha: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-lg fade-in">
        <div className="rounded-lg ring-1 ring-amber-500/30 bg-amber-500/[0.06] p-5">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-medium mb-2">
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-neutral-950 text-[10px] font-bold">!</span>
            Capture failed
          </div>
          <div className="text-xs text-neutral-400 font-mono mb-3">
            {props.snapshot.git.shortSha} · {props.snapshot.git.message}
          </div>
          {props.snapshot.error && (
            <pre className="whitespace-pre-wrap text-[11px] text-amber-100/80 bg-black/30 rounded p-3 max-h-48 overflow-auto font-mono leading-relaxed">
              {props.snapshot.error}
            </pre>
          )}
          <div className="mt-4 text-[11px] text-neutral-500 leading-relaxed">
            Common causes: dependency drift in older commits, missing env vars, dev-server boot timeout.
            See <code className="font-mono">.design-history/backfill-skipped.log</code> for the full trace.
          </div>
          <button
            onClick={() => props.onPrioritize(props.snapshot.id)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-amber-500/20 ring-1 ring-amber-500/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/30"
          >
            Retry capture →
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonShimmer({ animated = false }: { animated?: boolean }): React.JSX.Element {
  return (
    <div className="mx-auto w-[min(560px,80%)] aspect-[4/3] rounded-lg bg-neutral-900 ring-1 ring-white/5 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-800/40 to-transparent" />
      {animated && (
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-fuchsia-500/10 to-transparent animate-[shimmer_1.8s_linear_infinite]" style={{ backgroundSize: '200% 100%' }} />
      )}
      <div className="absolute inset-x-6 top-6 h-3 rounded bg-white/5" />
      <div className="absolute inset-x-6 top-12 h-3 w-2/3 rounded bg-white/5" />
      <div className="absolute inset-x-6 bottom-8 h-10 rounded bg-white/5" />
    </div>
  );
}
