import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { DesignHistoryConfig, RouteConfig, SnapshotFrame, ViewportConfig } from './types.js';
import { authPath } from './paths.js';

/** Width of the small WebP thumbnail used by the dial / map. */
const THUMB_WIDTH = 320;

/**
 * Write a small WebP thumbnail next to a full-size PNG. Lazy-imports sharp so a
 * missing/broken native build never blocks a capture — the viewer just falls
 * back to the full image. Returns the thumbnail's basename, or null.
 */
async function makeThumb(pngPath: string): Promise<string | null> {
  try {
    const { default: sharp } = await import('sharp');
    const thumbName = pngPath.replace(/\.png$/, '.thumb.webp');
    await sharp(pngPath)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(thumbName);
    return path.basename(thumbName);
  } catch {
    return null;
  }
}

export interface CaptureBundleOptions {
  projectRoot: string;
  config: DesignHistoryConfig;
  outDir: string;
  baseUrl?: string; // override config.devServer (used by backfill)
  browser?: Browser;
  /** Concrete routes to capture (resolves config.routes, incl. 'auto', upstream). */
  routes?: RouteConfig[];
}

export async function captureBundle(opts: CaptureBundleOptions): Promise<SnapshotFrame[]> {
  const { projectRoot, config, outDir, baseUrl } = opts;
  const routes: RouteConfig[] =
    opts.routes ?? (Array.isArray(config.routes) ? config.routes : [{ path: '/', label: 'Home' }]);
  fs.mkdirSync(outDir, { recursive: true });

  const authFile = authPath(projectRoot);
  const storageState = fs.existsSync(authFile) ? authFile : undefined;
  const base = (baseUrl ?? config.devServer).replace(/\/$/, '');

  const browser = opts.browser ?? (await chromium.launch({ headless: true }));
  const ownsBrowser = !opts.browser;

  try {
    const viewportFrames = await Promise.all(
      config.viewports.map(async (viewport) => {
      const context: BrowserContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        storageState,
      });
        const frames: SnapshotFrame[] = [];

        try {
          const page = await context.newPage();
          for (const route of routes) {
            try {
              const frame = await captureOne(page, base, route, viewport, outDir, config);
              frames.push(frame);
            } catch (err) {
              console.error(
                `  ! Failed to capture ${route.path} @ ${viewport.name}: ${(err as Error).message}`,
              );
            }
          }
        } finally {
          await context.close();
        }
        return frames;
      }),
    );
    return viewportFrames.flat();
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

async function captureOne(
  page: import('playwright').Page,
  baseUrl: string,
  route: RouteConfig,
  viewport: ViewportConfig,
  outDir: string,
  config: DesignHistoryConfig,
): Promise<SnapshotFrame> {
  const url = `${baseUrl}${route.path.startsWith('/') ? route.path : `/${route.path}`}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  const wait = route.waitFor ?? config.waitFor ?? 'networkidle';
  if (typeof wait === 'number') {
    await page.waitForTimeout(wait);
  } else if (wait === 'networkidle' || wait === 'load' || wait === 'domcontentloaded') {
    await page.waitForLoadState(wait, { timeout: 15_000 }).catch(() => {});
  } else if (typeof wait === 'string') {
    await page.waitForSelector(wait, { timeout: 15_000 }).catch(() => {});
  }

  // Small settle for animations / web fonts.
  await page.waitForTimeout(250);

  const safeName = `${slug(route.path)}-${viewport.name}.png`;
  const file = path.join(outDir, safeName);
  await page.screenshot({ path: file, fullPage: false });
  const thumb = await makeThumb(file);

  return {
    routePath: route.path,
    routeLabel: route.label ?? route.path,
    viewport: viewport.name,
    file: path.relative(outDir, file),
    thumb: thumb ?? undefined,
    width: viewport.width,
    height: viewport.height,
  };
}

function slug(s: string): string {
  const cleaned = s.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
  return cleaned.length === 0 ? 'home' : cleaned;
}
