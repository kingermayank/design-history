/**
 * Resolve `routes: 'auto'` into a concrete list of routes to capture.
 *
 * Strategy, in order of reliability:
 *   1. sitemap.xml served by the running app (cross-framework, authoritative)
 *   2. file-based routing on disk (Next app/pages, SvelteKit, Astro, Nuxt, Remix)
 *   3. a shallow same-origin crawl from "/"
 *
 * Dynamic routes (`[slug]`, `:id`, `*`) are skipped — they need a concrete
 * value, which the user supplies by listing them explicitly in the config.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isReachable } from './devServer.js';
import type { DesignHistoryConfig, RouteConfig } from './types.js';

const MAX_ROUTES = 50;

export async function resolveRoutes(
  projectRoot: string,
  config: DesignHistoryConfig,
  baseUrl: string,
): Promise<RouteConfig[]> {
  if (Array.isArray(config.routes)) return config.routes;

  // 'auto'
  const base = baseUrl.replace(/\/$/, '');
  let paths = await fromSitemap(base);
  let source = 'sitemap.xml';
  if (paths.length === 0) {
    paths = fromFileRouting(projectRoot);
    source = 'file-based routing';
  }
  if (paths.length === 0) {
    paths = await crawl(base);
    source = 'crawl';
  }

  const seen = new Set<string>();
  const routes: RouteConfig[] = [];
  for (const p of ['/', ...paths]) {
    const norm = normalizePath(p);
    if (norm === null || seen.has(norm)) continue;
    seen.add(norm);
    routes.push({ path: norm, label: labelFor(norm) });
    if (routes.length >= MAX_ROUTES) break;
  }
  console.log(`  ✓ auto-discovered ${routes.length} route(s) via ${source}`);
  return routes;
}

function normalizePath(p: string): string | null {
  let s = p.trim();
  try {
    if (/^https?:\/\//.test(s)) s = new URL(s).pathname;
  } catch {
    /* keep as-is */
  }
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/+$/, '') || '/';
  // Skip dynamic / non-visual paths.
  if (/[[\]:*]/.test(s)) return null;
  if (/\.(xml|json|txt|ico|png|jpe?g|svg|webp|css|js|map)$/i.test(s)) return null;
  if (s.startsWith('/api')) return null;
  return s;
}

function labelFor(p: string): string {
  if (p === '/') return 'Home';
  const last = p.split('/').filter(Boolean).pop() ?? p;
  return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- 1. sitemap ---------------------------------------------------------

async function fromSitemap(base: string): Promise<string[]> {
  for (const name of ['/sitemap.xml', '/sitemap-index.xml', '/sitemap_index.xml']) {
    try {
      if (!(await isReachable(base + name, 2500))) continue;
      const res = await fetch(base + name);
      if (!res.ok) continue;
      const xml = await res.text();
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] ?? '');
      // A sitemap index points at more sitemaps; follow one level.
      if (name.includes('index') || locs.some((l) => l.endsWith('.xml'))) {
        const nested: string[] = [];
        for (const sm of locs.filter((l) => l.endsWith('.xml')).slice(0, 5)) {
          try {
            const r = await fetch(sm);
            if (r.ok) {
              const t = await r.text();
              nested.push(...[...t.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] ?? ''));
            }
          } catch {
            /* skip */
          }
        }
        if (nested.length) return nested;
      }
      if (locs.length) return locs;
    } catch {
      /* try next */
    }
  }
  return [];
}

// --- 2. file-based routing ---------------------------------------------

function fromFileRouting(projectRoot: string): string[] {
  const roots: { dir: string; kind: 'next-app' | 'next-pages' | 'flat' | 'svelte' }[] = [
    { dir: 'app', kind: 'next-app' },
    { dir: 'src/app', kind: 'next-app' },
    { dir: 'pages', kind: 'next-pages' },
    { dir: 'src/pages', kind: 'flat' }, // Astro / Nuxt-ish
    { dir: 'src/routes', kind: 'svelte' }, // SvelteKit
    { dir: 'app/routes', kind: 'flat' }, // Remix
  ];
  for (const { dir, kind } of roots) {
    const abs = path.join(projectRoot, dir);
    if (!fs.existsSync(abs)) continue;
    const out = new Set<string>();
    walk(abs, abs, kind, out);
    if (out.size) return [...out];
  }
  return [];
}

const PAGE_FILE = {
  'next-app': /^page\.(tsx|jsx|ts|js|mdx)$/,
  'next-pages': /\.(tsx|jsx|ts|js|mdx)$/,
  flat: /\.(tsx|jsx|ts|js|astro|vue|svelte|mdx)$/,
  svelte: /^\+page\.(svelte|ts|js)$/,
};

function walk(root: string, dir: string, kind: keyof typeof PAGE_FILE, out: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'api') continue;
      walk(root, full, kind, out);
    } else if (PAGE_FILE[kind].test(e.name)) {
      const p = fileToRoute(root, full, kind, e.name);
      if (p !== null) out.add(p);
    }
  }
}

function fileToRoute(root: string, full: string, kind: keyof typeof PAGE_FILE, name: string): string | null {
  let rel: string;
  if (kind === 'next-app' || kind === 'svelte') {
    // The route is the directory containing the page file.
    rel = path.relative(root, path.dirname(full)).replace(/\\/g, '/');
  } else {
    rel = path.relative(root, full).replace(/\\/g, '/');
    rel = rel.replace(/\.(tsx|jsx|ts|js|astro|vue|svelte|mdx)$/, '');
    rel = rel.replace(/\/?index$/, '');
    if (/^_/.test(name) || /^_(app|document|error)/.test(rel)) return null; // Next specials
  }
  rel = rel.replace(/\([^/]+\)\/?/g, ''); // strip route groups (marketing)/
  if (/[[\]:*]/.test(rel)) return null; // dynamic
  const p = '/' + rel.replace(/^\/+|\/+$/g, '');
  return p === '/' || p.length > 1 ? p : '/';
}

// --- 3. crawl -----------------------------------------------------------

async function crawl(base: string, maxPages = 30): Promise<string[]> {
  const found = new Set<string>(['/']);
  const queue = ['/'];
  const origin = safeOrigin(base);
  while (queue.length && found.size < maxPages) {
    const p = queue.shift()!;
    try {
      const res = await fetch(base + p);
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('text/html')) continue;
      const html = await res.text();
      for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        let href = m[1] ?? '';
        if (href.startsWith('//') || /^https?:\/\//.test(href)) {
          if (safeOrigin(href) !== origin) continue;
          try {
            href = new URL(href).pathname;
          } catch {
            continue;
          }
        }
        if (!href.startsWith('/')) continue;
        const norm = href.replace(/\/+$/, '') || '/';
        if (!found.has(norm) && !/[[\]:*]/.test(norm) && !norm.startsWith('/api')) {
          found.add(norm);
          if (queue.length + found.size < maxPages) queue.push(norm);
        }
      }
    } catch {
      /* skip */
    }
  }
  return [...found];
}

function safeOrigin(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
}
