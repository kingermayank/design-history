import React from 'react';

export function EmptyState(): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center fade-in">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-accent-500/12 ring-1 ring-accent-500/25">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 8v4l2.5 1.5" />
          </svg>
        </div>
        <h1 className="font-serif text-[22px] font-medium tracking-tight mb-2 text-[var(--ink-900)]">No snapshots yet</h1>
        <p className="text-[var(--ink-500)] leading-relaxed">
          Make a commit while your dev server is running — design-history will capture it
          automatically. Or run{' '}
          <code className="px-1.5 py-0.5 rounded bg-neutral-900 font-mono text-xs text-neutral-200">
            npx design-history backfill
          </code>{' '}
          to bring in your existing commit history.
        </p>
      </div>
    </div>
  );
}
