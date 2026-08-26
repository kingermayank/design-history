import React from 'react';
import type { WorkerStatus } from '../types.js';

interface Props {
  status: WorkerStatus;
}

export function WorkerBanner({ status }: Props): React.JSX.Element | null {
  if (!status.running && status.queueLength === 0 && status.failedCount === 0) {
    return null;
  }
  if (status.queueLength === 0 && status.currentSha === null && status.failedCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-accent-500/[0.04] border-b border-accent-500/15 text-xs">
      {status.currentSha ? (
        <>
          <Spinner />
          <span className="text-neutral-300">
            Capturing <code className="font-mono text-neutral-400">{status.currentSha.slice(0, 7)}</code>…
          </span>
        </>
      ) : status.queueLength > 0 ? (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="text-neutral-300">{status.queueLength} commit{status.queueLength === 1 ? '' : 's'} pending capture</span>
        </>
      ) : (
        <>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-neutral-300">All caught up</span>
        </>
      )}
      <span className="text-neutral-600 ml-auto">
        Click any pending commit to capture it next.
        {status.failedCount > 0 && (
          <> · <span className="text-amber-400">{status.failedCount} failed</span></>
        )}
      </span>
    </div>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <svg
      className="h-3 w-3 animate-spin text-accent-400"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
