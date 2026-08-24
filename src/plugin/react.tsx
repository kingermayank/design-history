'use client';
/**
 * <DesignHistory /> — the framework-agnostic in-app time-travel button.
 *
 * Drop it once into your app root (e.g. Next.js `app/layout.tsx`, a Remix root,
 * or your top-level component). It mounts the floating button + dial overlay in
 * development and renders nothing in production. The overlay is Shadow-DOM
 * isolated, so it never touches your app's styles.
 *
 * It reads the captured history from `/__design-history/` — served statically
 * from your app's public directory (design-history init sets up the symlink).
 *
 *   import { DesignHistory } from 'design-history/react'
 *   // …then, inside <body>:  <DesignHistory />
 */
import { useEffect } from 'react';
import { mountOverlay } from './overlay-core.js';

export interface DesignHistoryProps {
  /** Where the history is served. Default: "/__design-history". */
  base?: string;
  /** Show the button in production too (default: development only). */
  force?: boolean;
}

export function DesignHistory(props: DesignHistoryProps = {}): null {
  const { base, force } = props;
  useEffect(() => {
    const isProd =
      typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
    if (isProd && !force) return;
    mountOverlay({ base });
  }, [base, force]);
  return null;
}

export default DesignHistory;
