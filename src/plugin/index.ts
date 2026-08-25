/**
 * vite-plugin-design-history
 *
 * Injects the design-history time-travel overlay into your app during `npm run
 * dev`, and serves the captured snapshots from `.design-history/`. A floating
 * button appears bottom-right; click it to scrub through your visual history.
 *
 * Usage:
 *   import designHistory from 'design-history/vite'
 *   export default { plugins: [designHistory()] }
 *
 * The plugin is dev-only (`apply: 'serve'`) and injects nothing into production
 * builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = '/__design-history';

export interface DesignHistoryPluginOptions {
  /** Where the captured history lives, relative to project root. */
  dir?: string;
  /** Set false to disable the injected overlay (data still served). */
  overlay?: boolean;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function resolveOverlayBundle(): string | null {
  const candidates = [
    path.resolve(__dirname, 'overlay.js'), // dist/plugin/overlay.js (packaged)
    path.resolve(__dirname, '../dist/plugin/overlay.js'),
    path.resolve(__dirname, '../../dist/plugin/overlay.js'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function safeJoin(root: string, target: string): string | null {
  const resolved = path.resolve(root, target);
  return resolved.startsWith(path.resolve(root)) ? resolved : null;
}

// Minimal Vite plugin type — kept local so we don't require `vite` as a dep.
interface VitePluginLike {
  name: string;
  apply?: 'serve' | 'build';
  configureServer?: (server: {
    config: { root: string };
    middlewares: {
      use: (
        fn: (
          req: { url?: string; method?: string },
          res: {
            statusCode: number;
            setHeader: (k: string, v: string) => void;
            end: (body?: string | Buffer) => void;
          },
          next: () => void,
        ) => void,
      ) => void;
    };
  }) => void;
  transformIndexHtml?: (html: string) => { html: string; tags: unknown[] } | string;
}

export default function designHistory(
  options: DesignHistoryPluginOptions = {},
): VitePluginLike {
  const dirName = options.dir ?? '.design-history';
  const injectOverlay = options.overlay !== false;

  return {
    name: 'vite-plugin-design-history',
    apply: 'serve',

    configureServer(server) {
      const root = server.config.root;
      const historyDir = path.resolve(root, dirName);

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith(ROUTE)) return next();

        const rel = decodeURIComponent(url.slice(ROUTE.length).split('?')[0] ?? '');

        // manifest
        if (rel === '/manifest.json' || rel === '/manifest') {
          const file = path.join(historyDir, 'manifest.json');
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end('{"snapshots":[]}');
            return;
          }
          res.setHeader('content-type', MIME['.json']!);
          res.setHeader('cache-control', 'no-store');
          res.end(fs.readFileSync(file));
          return;
        }

        // overlay client bundle
        if (rel === '/overlay.js') {
          const bundle = resolveOverlayBundle();
          if (!bundle) {
            res.statusCode = 404;
            res.end('// design-history overlay bundle not found');
            return;
          }
          res.setHeader('content-type', MIME['.js']!);
          res.end(fs.readFileSync(bundle));
          return;
        }

        // snapshot images
        if (rel.startsWith('/snapshots/')) {
          const target = safeJoin(historyDir, rel.slice(1));
          if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          const ext = path.extname(target).toLowerCase();
          res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
          res.end(fs.readFileSync(target));
          return;
        }

        res.statusCode = 404;
        res.end();
      });
    },

    transformIndexHtml(html: string) {
      if (!injectOverlay) return html;
      const tag = `<script type="module" src="${ROUTE}/overlay.js"></script>`;
      if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`);
      return html + tag;
    },
  };
}
