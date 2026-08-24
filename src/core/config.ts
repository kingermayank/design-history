import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { DesignHistoryConfig } from './types.js';
import { configPath } from './paths.js';

const DEFAULTS = {
  installCommand: 'npm install',
  startCommand: 'npm run dev -- --port {port}',
  serverReadyTimeoutMs: 60_000,
  waitFor: 'networkidle' as const,
  backfill: {
    maxConcurrentWorktrees: 1,
    skipMergeCommits: true,
  },
  installCache: true,
  skip: { enabled: true },
};

export async function loadConfig(projectRoot: string): Promise<DesignHistoryConfig> {
  const file = configPath(projectRoot);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No design-history.config.js found at ${file}. Run \`npx design-history init\` first.`,
    );
  }
  const mod = await import(pathToFileURL(file).href);
  const raw = (mod.default ?? mod) as Partial<DesignHistoryConfig>;
  return validate(raw);
}

function validate(raw: Partial<DesignHistoryConfig>): DesignHistoryConfig {
  if (!raw.devServer || typeof raw.devServer !== 'string') {
    throw new Error('config.devServer must be a string URL (e.g. "http://localhost:3000").');
  }
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) {
    throw new Error('config.routes must be a non-empty array.');
  }
  if (!Array.isArray(raw.viewports) || raw.viewports.length === 0) {
    throw new Error('config.viewports must be a non-empty array.');
  }
  for (const r of raw.routes) {
    if (!r.path || typeof r.path !== 'string') {
      throw new Error('Every route must have a string `path`.');
    }
  }
  for (const v of raw.viewports) {
    if (!v.name || typeof v.width !== 'number' || typeof v.height !== 'number') {
      throw new Error('Every viewport needs { name, width, height }.');
    }
  }
  return {
    devServer: raw.devServer.replace(/\/$/, ''),
    routes: raw.routes.map((r) => ({ ...r, label: r.label ?? r.path })),
    viewports: raw.viewports,
    waitFor: raw.waitFor ?? DEFAULTS.waitFor,
    installCommand: raw.installCommand ?? DEFAULTS.installCommand,
    startCommand: raw.startCommand ?? DEFAULTS.startCommand,
    serverReadyTimeoutMs: raw.serverReadyTimeoutMs ?? DEFAULTS.serverReadyTimeoutMs,
    backfill: {
      maxConcurrentWorktrees:
        raw.backfill?.maxConcurrentWorktrees ?? DEFAULTS.backfill.maxConcurrentWorktrees,
      skipMergeCommits: raw.backfill?.skipMergeCommits ?? DEFAULTS.backfill.skipMergeCommits,
    },
    installCache: raw.installCache ?? DEFAULTS.installCache,
    skip: {
      enabled: raw.skip?.enabled ?? DEFAULTS.skip.enabled,
      patterns: raw.skip?.patterns,
      extend: raw.skip?.extend,
      remove: raw.skip?.remove,
    },
  };
}

export function defaultConfigSource(): string {
  return `// design-history.config.js
// Docs: https://github.com/your-org/design-history

/** @type {import('design-history').DesignHistoryConfig} */
export default {
  devServer: 'http://localhost:3000',

  // The routes you want captured on every commit.
  routes: [
    { path: '/', label: 'Home' },
    // { path: '/dashboard', label: 'Dashboard', requiresAuth: true },
  ],

  // Two viewports give responsive coverage at a small storage cost.
  viewports: [
    { name: 'mobile',  width: 390,  height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],

  // Optional: 'networkidle' | 'load' | 'domcontentloaded' | <selector> | <ms>
  waitFor: 'networkidle',

  // Used by \`design-history backfill\` when replaying old commits.
  installCommand: 'npm install',
  // {port} is replaced with an available port during backfill.
  startCommand: 'npm run dev -- --port {port}',
  serverReadyTimeoutMs: 60000,

  backfill: {
    maxConcurrentWorktrees: 1,
    skipMergeCommits: true,
  },
};
`;
}
