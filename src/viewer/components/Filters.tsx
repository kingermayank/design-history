import React from 'react';

interface Props {
  routes: string[];
  viewports: string[];
  routePath: string | null;
  viewport: string | null;
  search: string;
  onRoute: (s: string) => void;
  onViewport: (s: string) => void;
  onSearch: (s: string) => void;
}

export function Filters(props: Props): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-[var(--hairline)] bg-neutral-950/60">
      <Select
        label="Route"
        value={props.routePath ?? ''}
        options={props.routes}
        onChange={props.onRoute}
      />
      <Select
        label="Viewport"
        value={props.viewport ?? ''}
        options={props.viewports}
        onChange={props.onViewport}
      />
      <div className="ml-auto relative">
        <input
          type="search"
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Search commit message, author, sha…"
          className="w-72 rounded-md bg-neutral-900 ring-1 ring-[var(--hairline)] border-0 px-3 py-1.5 text-sm text-[var(--ink-900)] placeholder:text-[var(--ink-400)] focus:ring-accent-500/50"
        />
      </div>
    </div>
  );
}

function Select(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (s: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-[var(--ink-500)]">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-md bg-neutral-900 ring-1 ring-[var(--hairline)] border-0 px-2 py-1 text-sm text-[var(--ink-900)] transition-colors duration-150 hover:ring-[var(--hairline-strong)] focus:ring-accent-500/50"
      >
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
