import React from 'react';

export function EmptyState(): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 h-12 w-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-amber-400" />
        <h1 className="text-xl font-semibold mb-2">No snapshots yet</h1>
        <p className="text-neutral-400 leading-relaxed">
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
