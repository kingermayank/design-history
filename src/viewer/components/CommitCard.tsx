import React from 'react';
import type { ViewerSnapshot } from '../types.js';

interface Props {
  snapshot: ViewerSnapshot | null;
  onPrioritize: (sha: string) => void;
}

export function CommitCard(props: Props): React.JSX.Element {
  const s = props.snapshot;
  if (!s) {
    return <div className="p-5 text-neutral-600 text-sm">No snapshot selected.</div>;
  }
  const date = new Date(s.git.isoTime);
  return (
    <div className="p-5 fade-in">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <StateBadge state={s.state} />
        {s.state === 'done' && <SourceBadge source={s.source} />}
        <span className="font-mono text-xs text-neutral-500">{s.git.shortSha}</span>
      </div>
      <h2 className="text-base font-semibold leading-snug text-neutral-100 mb-3 break-words">
        {s.git.message}
      </h2>
      <dl className="space-y-2 text-sm">
        <Row label="Author">
          <span className="text-neutral-200">{s.git.author}</span>
        </Row>
        <Row label="When">
          <span className="text-neutral-200" title={date.toISOString()}>
            {timeAgo(date)}
          </span>
          <span className="text-neutral-500 ml-2 text-xs">{date.toLocaleString()}</span>
        </Row>
        <Row label="Branch">
          <code className="text-neutral-200 font-mono text-xs">{s.git.branch}</code>
        </Row>
        {s.state === 'done' ? (
          <Row label="Frames">
            <span className="text-neutral-200">{s.frames.length}</span>
          </Row>
        ) : null}
      </dl>
      {(s.state === 'pending' || s.state === 'queued' || s.state === 'failed') && (
        <button
          onClick={() => props.onPrioritize(s.id)}
          className="mt-5 w-full rounded-md bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30 px-3 py-2 text-xs text-fuchsia-200 hover:bg-fuchsia-500/25"
        >
          {s.state === 'failed' ? 'Retry capture' : 'Capture next'} →
        </button>
      )}
      {s.state === 'skipped' && (
        <>
          <div className="mt-4 text-xs text-neutral-500 leading-relaxed">
            Skipped automatically:{' '}
            <span className="text-neutral-300">{s.skipReason ?? 'non-visual diff'}</span>.
          </div>
          <button
            onClick={() => props.onPrioritize(s.id)}
            className="mt-3 w-full rounded-md bg-neutral-700/30 ring-1 ring-neutral-600/40 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-700/50"
          >
            Capture anyway →
          </button>
        </>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: ViewerSnapshot['state'] }): React.JSX.Element {
  const styles: Record<ViewerSnapshot['state'], string> = {
    pending: 'bg-neutral-500/15 text-neutral-400 ring-neutral-500/30',
    queued: 'bg-fuchsia-300/15 text-fuchsia-200 ring-fuchsia-300/30',
    capturing: 'bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30',
    done: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
    failed: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    skipped: 'bg-neutral-700/30 text-neutral-300 ring-neutral-600/40',
  };
  const labels: Record<ViewerSnapshot['state'], string> = {
    pending: 'Pending',
    queued: 'Up next',
    capturing: 'Capturing',
    done: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ring-1 ${styles[state]}`}
    >
      {labels[state]}
    </span>
  );
}

function SourceBadge({ source }: { source: ViewerSnapshot['source'] }): React.JSX.Element {
  const styles: Record<ViewerSnapshot['source'], string> = {
    live: 'bg-emerald-500/[0.08] text-emerald-300/80 ring-emerald-500/20',
    backfill: 'bg-amber-500/[0.08] text-amber-300/80 ring-amber-500/20',
    snap: 'bg-sky-500/[0.08] text-sky-300/80 ring-sky-500/20',
  };
  const labels: Record<ViewerSnapshot['source'], string> = {
    live: 'Live',
    backfill: 'Backfill',
    snap: 'Snap',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ring-1 ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

function Row(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-16 shrink-0 text-xs uppercase tracking-wider text-neutral-500">
        {props.label}
      </dt>
      <dd className="flex-1">{props.children}</dd>
    </div>
  );
}

function timeAgo(d: Date): string {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.34524, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [size, name] of units) {
    if (Math.abs(value) < size) {
      unit = name;
      break;
    }
    value = value / size;
    unit = name;
  }
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return rtf.format(-Math.round(value), unit);
}
