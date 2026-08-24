import { spawn, type ChildProcess } from 'node:child_process';

export async function isReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal, method: 'GET' });
    clearTimeout(timer);
    // Any HTTP response means a server is up — even 404 is fine.
    return res.status > 0;
  } catch {
    return false;
  }
}

export async function waitForServer(
  url: string,
  timeoutMs: number,
  pollMs = 500,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReachable(url)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

/** Normalize any localhost-ish URL to a fetchable origin (protocol//host:port). */
export function normalizeOrigin(raw: string): string {
  try {
    const u = new URL(raw);
    let host = u.hostname;
    // 0.0.0.0 / :: are bind-all addresses; fetch them via loopback.
    if (host === '0.0.0.0' || host === '::' || host === '::1' || host === '[::1]') {
      host = '127.0.0.1';
    }
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${host}${port}`;
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

// Matches the URLs dev servers announce, e.g.
//   Vite:  ➜  Local:   http://localhost:5173/
//   Next:  - Local:        http://localhost:3000
//   Astro: ┃ Local    http://localhost:4321/
const ANNOUNCED_URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+(?:\/\S*)?/gi;

// Dev servers (Vite v6 especially) emit color escapes even to a pipe, and can
// inject an escape *between* the colon and the port — `http://localhost:\x1b[1m5174`
// — which breaks naive URL parsing. Strip escapes before matching.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

export function extractAnnouncedOrigins(text: string): string[] {
  const matches = stripAnsi(text).match(ANNOUNCED_URL_RE);
  if (!matches) return [];
  const out: string[] = [];
  for (const m of matches) {
    const origin = normalizeOrigin(m);
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

export interface ManagedServer {
  child: ChildProcess;
  /** The origin that actually responded — may differ from what we guessed. */
  url: string;
  stop: () => Promise<void>;
}

/**
 * Boot a dev server and figure out its real URL.
 *
 * Frameworks ignore our port hint in inconsistent ways (Vite ignores $PORT and
 * boots on 5173; Next honors it). Rather than trust the port we asked for, we
 * ALSO parse the server's own stdout for the URL it announces and poll that.
 * URLs discovered from stdout win over the guessed one, so the common case —
 * `startCommand: 'npm run dev'` with no port flag — just works.
 */
export async function startDevServer(
  command: string,
  cwd: string,
  guessedUrl: string,
  timeoutMs: number,
  onLog?: (chunk: string) => void,
): Promise<ManagedServer> {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0', NO_COLOR: '1' },
    detached: false,
  });

  // A failed spawn (e.g. transient `spawn /bin/sh ENOENT`) emits an async
  // 'error' event; left unhandled it crashes the whole process. Capture it and
  // surface it as a normal per-commit failure instead.
  let spawnError: Error | null = null;
  child.on('error', (err) => {
    spawnError = err as Error;
  });

  const guessed = normalizeOrigin(guessedUrl);
  const announced: string[] = []; // ordered, from stdout — preferred
  let logs = '';

  const handle = (b: Buffer): void => {
    const s = b.toString();
    logs = (logs + s).slice(-8000);
    // Parse the accumulated buffer, not just this chunk — a dev server can
    // split its announced URL across two 'data' events.
    for (const origin of extractAnnouncedOrigins(logs)) {
      if (!announced.includes(origin)) announced.push(origin);
    }
    onLog?.(s);
  };
  child.stdout?.on('data', handle);
  child.stderr?.on('data', handle);

  const start = Date.now();
  let discovered: string | null = null;

  while (Date.now() - start < timeoutMs) {
    if (spawnError) {
      throw new Error(`could not start dev server: ${(spawnError as Error).message}`);
    }
    if (child.exitCode !== null) {
      throw new Error(
        `dev server exited early (code ${child.exitCode})${logs ? `: ${lastLine(logs)}` : ''}`,
      );
    }
    // Try stdout-announced origins first, then the port we guessed.
    for (const candidate of [...announced, guessed]) {
      if (await isReachable(candidate, 1500)) {
        discovered = candidate;
        break;
      }
    }
    if (discovered) break;
    await new Promise((r) => setTimeout(r, 400));
  }

  if (!discovered) {
    await terminate(child);
    const tried = [...new Set([...announced, guessed])].join(', ');
    throw new Error(
      `dev server did not become reachable within ${timeoutMs}ms (tried ${tried})` +
        `${logs ? `\n  last output: ${lastLine(logs)}` : ''}`,
    );
  }

  return {
    child,
    url: discovered,
    stop: () => terminate(child),
  };
}

function lastLine(s: string): string {
  const clean = stripAnsi(s);
  return clean.split('\n').filter((l) => l.trim().length > 0).slice(-1)[0] ?? clean.trim();
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  return new Promise((resolve) => {
    const done = () => resolve();
    child.once('exit', done);
    try {
      child.kill('SIGTERM');
    } catch {
      /* noop */
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          /* noop */
        }
      }
    }, 3000);
    setTimeout(done, 6000);
  });
}
