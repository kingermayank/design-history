import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import { getRepoRoot, isGitRepo, getCommitDiff, createRestoreBranch } from '../core/git.js';
import { historyRoot, manifestPath } from '../core/paths.js';
import { loadConfig } from '../core/config.js';
import { buildSkeletonManifest } from '../core/skeleton.js';
import { CaptureWorker } from '../core/worker.js';
import { writeManifest } from '../core/manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ViewOptions {
  port?: number;
  noOpen?: boolean;
  /** Set to false to skip the background capture worker (read-only viewer). */
  capture?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function resolveViewerDir(): string {
  const candidates = [
    path.resolve(__dirname, 'viewer'),
    path.resolve(__dirname, '../dist/viewer'),
    path.resolve(__dirname, '../../dist/viewer'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  throw new Error(
    'Viewer assets not found. If you are developing design-history locally, run `npm run build:viewer`.',
  );
}

function safeJoin(root: string, target: string): string | null {
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function runView(opts: ViewOptions = {}): Promise<void> {
  const cwd = process.cwd();
  if (!isGitRepo(cwd)) throw new Error('Not in a git repository.');
  const projectRoot = getRepoRoot(cwd);

  const viewerDir = resolveViewerDir();
  const dataDir = historyRoot(projectRoot);

  // Build the skeleton manifest from git log so the timeline is populated
  // before any capture runs.
  let workerStartError: string | null = null;
  let worker: CaptureWorker | null = null;
  const enableCapture = opts.capture !== false;

  try {
    const config = await loadConfig(projectRoot);
    buildSkeletonManifest({ projectRoot, config });
  } catch (err) {
    // No config? That's fine — viewer can still show whatever's already been
    // captured. Just don't start a worker.
    workerStartError = (err as Error).message;
    if (!fs.existsSync(manifestPath(projectRoot))) {
      // No manifest AND no config — write an empty one so the viewer renders
      // an empty state rather than 500ing.
      writeManifest(projectRoot, {
        version: 1,
        projectName: path.basename(projectRoot),
        createdAt: new Date().toISOString(),
        snapshots: [],
      });
    }
  }

  if (enableCapture && !workerStartError) {
    worker = new CaptureWorker(projectRoot);
    await worker.start();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/manifest') {
      try {
        const m = fs.readFileSync(manifestPath(projectRoot));
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(m);
      } catch {
        res.writeHead(500).end('manifest unreadable');
      }
      return;
    }

    if (pathname === '/api/state') {
      const payload = worker
        ? worker.status()
        : { running: false, currentSha: null, queueLength: 0, doneCount: 0, failedCount: 0, totalKnown: 0 };
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify({ ...payload, workerStartError }));
      return;
    }

    if (pathname === '/api/prioritize' && req.method === 'POST') {
      if (!worker) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'worker not running' }));
        return;
      }
      try {
        const body = (await readJsonBody(req)) as { sha?: string };
        if (!body.sha || typeof body.sha !== 'string') {
          res.writeHead(400).end('sha required');
          return;
        }
        worker.prioritize(body.sha);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400).end('bad json');
      }
      return;
    }

    if (pathname === '/api/diff') {
      const sha = url.searchParams.get('sha');
      if (!sha) {
        res.writeHead(400).end('sha required');
        return;
      }
      try {
        const diff = getCommitDiff(projectRoot, sha);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(diff));
      } catch (e) {
        res.writeHead(500).end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    if (pathname === '/api/restore' && req.method === 'POST') {
      try {
        const body = (await readJsonBody(req)) as { sha?: string };
        if (!body.sha) {
          res.writeHead(400).end('sha required');
          return;
        }
        const result = createRestoreBranch(projectRoot, body.sha);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (e) {
        res.writeHead(500).end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    if (pathname.startsWith('/data/')) {
      const target = safeJoin(dataDir, pathname.slice('/data/'.length));
      if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      fs.createReadStream(target).pipe(res);
      return;
    }

    // Viewer static assets (SPA fallback).
    let viewerPath = pathname === '/' ? '/index.html' : pathname;
    let target = safeJoin(viewerDir, viewerPath.slice(1));
    if (!target || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      target = path.join(viewerDir, 'index.html');
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });

  const port = opts.port ?? 0;
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  const viewerUrl = `http://localhost:${actual}`;
  console.log(`\n→ design-history viewer running at ${viewerUrl}`);
  if (worker) {
    console.log('  Background capture is on — frames will appear as they render.');
  } else if (workerStartError) {
    console.log(`  Background capture is off (${workerStartError.split('\n')[0]})`);
  }
  console.log('  Press Ctrl+C to stop.');
  if (!opts.noOpen) {
    open(viewerUrl).catch(() => {});
  }

  const shutdown = (): void => {
    worker?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
