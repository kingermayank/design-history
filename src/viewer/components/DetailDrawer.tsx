import React, { useEffect, useState } from 'react';
import type { ViewerSnapshot } from '../types.js';

interface DiffFile {
  file: string;
  added: number;
  removed: number;
}
interface CommitDiff {
  parent: string | null;
  files: DiffFile[];
  patch: string;
  truncated: boolean;
}

interface Props {
  snapshot: ViewerSnapshot | null;
  onClose: () => void;
}

export function DetailDrawer({ snapshot, onClose }: Props): React.JSX.Element | null {
  const [diff, setDiff] = useState<CommitDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [restore, setRestore] = useState<{ branch: string; switchCommand: string } | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    setDiff(null);
    setRestore(null);
    setLoading(true);
    fetch(`/api/diff?sha=${encodeURIComponent(snapshot.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`diff ${r.status}`))))
      .then((d: CommitDiff) => setDiff(d))
      .catch(() => setDiff(null))
      .finally(() => setLoading(false));
  }, [snapshot?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!snapshot) return null;
  const date = new Date(snapshot.git.isoTime);

  const doRestore = async (): Promise<void> => {
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sha: snapshot.id }),
      });
      const j = (await res.json()) as { ok: boolean; branch?: string; switchCommand?: string };
      if (j.ok && j.branch && j.switchCommand) {
        setRestore({ branch: j.branch, switchCommand: j.switchCommand });
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="flex-1 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="w-[min(560px,92vw)] h-full overflow-y-auto bg-neutral-950 border-l border-neutral-800 shadow-2xl fade-in">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 py-4 border-b border-neutral-900 bg-neutral-950/90 backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-accent-300">{snapshot.git.shortSha}</span>
              <span className="text-neutral-600 text-xs">·</span>
              <span className="text-xs text-neutral-500">{date.toLocaleString()}</span>
            </div>
            <h2 className="text-[15px] font-semibold text-neutral-100 leading-snug break-words">
              {snapshot.git.message}
            </h2>
            <div className="text-xs text-neutral-500 mt-1">
              {snapshot.git.author} · <code className="font-mono">{snapshot.git.branch}</code>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 h-8 w-8 grid place-items-center rounded-full bg-neutral-900 text-neutral-400 hover:text-neutral-100 ring-1 ring-neutral-800"
          >
            ✕
          </button>
        </div>

        {/* Restore */}
        <div className="px-5 py-4 border-b border-neutral-900">
          {restore ? (
            <div className="rounded-lg bg-emerald-500/[0.08] ring-1 ring-emerald-500/25 p-3">
              <div className="text-emerald-300 text-sm font-medium mb-1">Branch created</div>
              <div className="text-xs text-neutral-400 mb-2">
                Restore this version by switching to it:
              </div>
              <CopyRow text={restore.switchCommand} />
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-neutral-400">
                Bring this version back — creates a branch, doesn’t touch your work.
              </div>
              <button
                onClick={doRestore}
                className="shrink-0 rounded-md bg-accent-500/15 ring-1 ring-accent-500/30 px-3 py-1.5 text-xs text-accent-200 hover:bg-accent-500/25"
              >
                Restore →
              </button>
            </div>
          )}
        </div>

        {/* Diff */}
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-3">
            What changed
          </div>
          {loading && <div className="text-sm text-neutral-600">Loading diff…</div>}
          {!loading && diff && (
            <>
              <ul className="space-y-1 mb-4">
                {diff.files.map((f) => (
                  <li key={f.file} className="flex items-center gap-3 text-[13px]">
                    <span className="font-mono text-neutral-300 truncate flex-1" title={f.file}>
                      {f.file}
                    </span>
                    <span className="font-mono tabular-nums text-emerald-400">+{f.added}</span>
                    <span className="font-mono tabular-nums text-rose-400">-{f.removed}</span>
                  </li>
                ))}
                {diff.files.length === 0 && (
                  <li className="text-sm text-neutral-600">No file changes.</li>
                )}
              </ul>
              {diff.patch && <Patch patch={diff.patch} truncated={diff.truncated} />}
            </>
          )}
          {!loading && !diff && <div className="text-sm text-neutral-600">Diff unavailable.</div>}
        </div>
      </aside>
    </div>
  );
}

function Patch({ patch, truncated }: { patch: string; truncated: boolean }): React.JSX.Element {
  const lines = patch.split('\n');
  return (
    <div className="rounded-lg bg-black/40 ring-1 ring-neutral-900 overflow-x-auto">
      <pre className="text-[11.5px] leading-[1.5] font-mono p-3 min-w-max">
        {lines.map((l, i) => {
          let cls = 'text-neutral-400';
          if (l.startsWith('+') && !l.startsWith('+++')) cls = 'text-emerald-300 bg-emerald-500/[0.06]';
          else if (l.startsWith('-') && !l.startsWith('---')) cls = 'text-rose-300 bg-rose-500/[0.06]';
          else if (l.startsWith('@@')) cls = 'text-sky-300';
          else if (l.startsWith('diff ') || l.startsWith('index ')) cls = 'text-neutral-600';
          return (
            <div key={i} className={cls}>
              {l || ' '}
            </div>
          );
        })}
      </pre>
      {truncated && (
        <div className="px-3 py-2 text-[11px] text-neutral-600 border-t border-neutral-900">
          Diff truncated — open the commit in git for the full patch.
        </div>
      )}
    </div>
  );
}

function CopyRow({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/40 ring-1 ring-neutral-800 px-3 py-2">
      <code className="font-mono text-xs text-neutral-200 flex-1 truncate">{text}</code>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-[11px] text-neutral-400 hover:text-neutral-100"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
