/**
 * design-history in-app overlay — framework-agnostic core.
 *
 * Exposes mountOverlay(), used by the Vite plugin (script injection), the
 * React <DesignHistory/> component, and a plain <script> tag.
 *
 * Renders a floating action button bottom-right of the running app. Click it to
 * expand a time-travel dialer — the same thumbnail filmstrip + scrub interaction
 * as the standalone viewer — letting you flip through the visual history of your
 * app without leaving it.
 *
 * Written in dependency-free vanilla DOM inside a Shadow DOM, so it cannot
 * collide with the host app's React version, CSS, or global styles.
 */

interface Frame {
  routePath: string;
  routeLabel: string;
  viewport: string;
  file: string;
  width: number;
  height: number;
}
interface Snapshot {
  id: string;
  state: string;
  git: { shortSha: string; message: string; isoTime: string; author: string };
  frames: Frame[];
  referenceFrame?: string;
  skipReason?: string;
}
interface Manifest {
  projectName: string;
  snapshots: Snapshot[];
}

const THUMB_W = 56;
const THUMB_H = 38;
const GAP = 7;
const SPACING = THUMB_W + GAP;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

class Overlay {
  private root: ShadowRoot;
  private manifest: Manifest | null = null;
  private snaps: Snapshot[] = [];
  private byId = new Map<string, Snapshot>();
  private routes: string[] = [];
  private viewports: string[] = [];
  private route = '';
  private viewport = '';
  private index = 0;
  private expanded = false;
  private drag: { startX: number; base: number; dx: number } | null = null;
  private base: string;

  // cached nodes
  private panel!: HTMLDivElement;
  private preview!: HTMLImageElement;
  private previewEmpty!: HTMLDivElement;
  private dateEl!: HTMLDivElement;
  private msgEl!: HTMLDivElement;
  private strip!: HTMLDivElement;
  private posEl!: HTMLDivElement;
  private routeRow!: HTMLDivElement;

  constructor(opts: { base?: string } = {}) {
    this.base = opts.base ?? '/__design-history';
    const host = el('div', { id: 'design-history-overlay' });
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    document.body.appendChild(host);
    this.root = host.attachShadow({ mode: 'open' });
    this.root.append(this.styles(), this.buildFab(), this.buildPanel());
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/manifest.json`, { cache: 'no-store' });
      if (!res.ok) return;
      this.manifest = (await res.json()) as Manifest;
      this.snaps = this.manifest.snapshots ?? [];
      this.byId = new Map(this.snaps.map((s) => [s.id, s]));
      const rset = new Set<string>();
      const vset = new Set<string>();
      this.snaps.forEach((s) => s.frames.forEach((f) => {
        rset.add(f.routePath);
        vset.add(f.viewport);
      }));
      this.routes = [...rset];
      this.viewports = [...vset];
      this.route = this.routes[0] ?? '';
      this.viewport = this.viewports.includes('desktop') ? 'desktop' : (this.viewports[0] ?? '');
      this.index = this.lastShowableIndex();
      this.renderRoutes();
      this.render();
    } catch {
      /* dev server not serving history — stay dormant */
    }
  }

  private lastShowableIndex(): number {
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.effectiveFrameSrc(this.snaps[i]!)) return i;
    }
    return Math.max(0, this.snaps.length - 1);
  }

  private resolveRef(s: Snapshot): Snapshot | null {
    let cur: Snapshot | undefined = s;
    const seen = new Set<string>();
    while (cur) {
      if (cur.state === 'done' && cur.frames.length) return cur;
      if (cur.state !== 'skipped' || !cur.referenceFrame || seen.has(cur.id)) return null;
      seen.add(cur.id);
      cur = this.byId.get(cur.referenceFrame);
    }
    return null;
  }

  private effectiveFrameSrc(s: Snapshot): string | null {
    const eff = s.state === 'skipped' ? this.resolveRef(s) ?? s : s;
    const frame = eff.frames.find(
      (f) => (!this.route || f.routePath === this.route) && (!this.viewport || f.viewport === this.viewport),
    );
    if (!frame) return null;
    return `${this.base}/snapshots/${encodeURIComponent(eff.id)}/${encodeURIComponent(frame.file)}`;
  }

  private clamp(i: number): number {
    return Math.max(0, Math.min(this.snaps.length - 1, i));
  }

  private select(i: number): void {
    this.index = this.clamp(i);
    this.render();
  }

  // ---- rendering -------------------------------------------------------

  private render(): void {
    const s = this.snaps[this.index];
    if (!s) return;
    const src = this.effectiveFrameSrc(s);
    if (src) {
      this.preview.src = src;
      this.preview.style.display = 'block';
      this.previewEmpty.style.display = 'none';
    } else {
      this.preview.style.display = 'none';
      this.previewEmpty.style.display = 'flex';
      this.previewEmpty.textContent =
        s.state === 'pending' || s.state === 'queued'
          ? 'Not captured yet'
          : s.state === 'failed'
            ? 'Capture failed for this commit'
            : 'No frame for this route';
    }
    const d = new Date(s.git.isoTime);
    this.dateEl.textContent = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}  ·  ${s.git.shortSha}`;
    this.msgEl.textContent = s.git.message;
    this.posEl.textContent = `${this.index + 1} / ${this.snaps.length}`;
    this.renderStrip();
  }

  private renderStrip(): void {
    const float = this.drag ? this.clamp(this.drag.base - this.drag.dx / SPACING) : this.index;
    this.strip.innerHTML = '';
    const inner = el('div');
    inner.style.cssText = `position:absolute;left:50%;top:50%;display:flex;gap:${GAP}px;align-items:center;transform:translate(-${float * SPACING + THUMB_W / 2}px,-50%);transition:${this.drag ? 'none' : 'transform 240ms cubic-bezier(.22,1,.36,1)'};`;
    this.snaps.forEach((s, i) => {
      const active = i === Math.round(float);
      const btn = el('button');
      btn.className = 'thumb' + (active ? ' active' : '');
      btn.title = `${s.git.shortSha} — ${s.git.message}`;
      btn.style.width = `${THUMB_W}px`;
      btn.style.height = `${THUMB_H}px`;
      const src = this.effectiveFrameSrc(s);
      if (src) {
        const img = el('img', { src, loading: 'lazy' });
        btn.append(img);
      } else {
        const ph = el('div', { className: 'ph', textContent: s.git.shortSha.slice(0, 5) });
        btn.append(ph);
      }
      btn.addEventListener('click', () => {
        if (this.drag && Math.abs(this.drag.dx) > 4) return;
        this.select(i);
      });
      inner.append(btn);
    });
    this.strip.append(inner);
  }

  private renderRoutes(): void {
    this.routeRow.innerHTML = '';
    if (this.routes.length <= 1) {
      this.routeRow.style.display = 'none';
      return;
    }
    this.routeRow.style.display = 'flex';
    this.routes.forEach((r) => {
      const label =
        this.snaps.flatMap((s) => s.frames).find((f) => f.routePath === r)?.routeLabel ?? r;
      const chip = el('button', { textContent: label });
      chip.className = 'chip' + (r === this.route ? ' on' : '');
      chip.addEventListener('click', () => {
        this.route = r;
        this.index = this.lastShowableIndex();
        this.renderRoutes();
        this.render();
      });
      this.routeRow.append(chip);
    });
  }

  // ---- fab + panel shells ---------------------------------------------

  private buildFab(): HTMLElement {
    const fab = el('button', { id: 'fab' });
    fab.setAttribute('aria-label', 'Open design history');
    fab.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></svg>`;
    fab.addEventListener('click', () => this.toggle(true));
    return fab;
  }

  private buildPanel(): HTMLElement {
    this.preview = el('img', { id: 'preview', alt: '' });
    this.previewEmpty = el('div', { id: 'preview-empty' });
    const previewWrap = el('div', { id: 'preview-wrap' }, this.preview, this.previewEmpty);

    this.dateEl = el('div', { id: 'date' });
    this.msgEl = el('div', { id: 'msg' });
    const close = el('button', { id: 'close', innerHTML: '&times;' });
    close.addEventListener('click', () => this.toggle(false));
    const readout = el('div', { id: 'readout' }, el('div', {}, this.dateEl, this.msgEl), close);

    const prev = el('button', { className: 'nav', innerHTML: chevron('left'), title: 'Previous' });
    prev.addEventListener('click', () => this.select(this.index - 1));
    const next = el('button', { className: 'nav', innerHTML: chevron('right'), title: 'Next' });
    next.addEventListener('click', () => this.select(this.index + 1));

    this.strip = el('div', { id: 'strip' });
    const needle = el('div', { id: 'needle' });
    this.attachDrag(this.strip);
    const track = el('div', { id: 'track' }, needle, this.strip);
    const dial = el('div', { id: 'dial' }, prev, track, next);

    this.posEl = el('div', { id: 'pos' });
    this.routeRow = el('div', { id: 'routes' });

    this.panel = el('div', { id: 'panel' }, readout, previewWrap, this.routeRow, dial, this.posEl) as HTMLDivElement;
    return this.panel;
  }

  private attachDrag(strip: HTMLDivElement): void {
    strip.addEventListener('pointerdown', (e) => {
      this.drag = { startX: e.clientX, base: this.index, dx: 0 };
    });
    strip.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.drag.dx = e.clientX - this.drag.startX;
      const rounded = this.clamp(Math.round(this.drag.base - this.drag.dx / SPACING));
      if (rounded !== this.index) {
        this.index = rounded;
        this.render();
      } else {
        this.renderStrip();
      }
    });
    const end = (): void => {
      if (!this.drag) return;
      this.index = this.clamp(Math.round(this.drag.base - this.drag.dx / SPACING));
      this.drag = null;
      this.render();
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
    strip.addEventListener('pointerleave', () => {
      if (this.drag) end();
    });
  }

  private toggle(open: boolean): void {
    this.expanded = open;
    this.root.host.setAttribute('data-open', String(open));
    (this.root.getElementById('fab') as HTMLElement).style.display = open ? 'none' : 'grid';
    this.panel.style.display = open ? 'flex' : 'none';
    if (open) this.render();
  }

  private styles(): HTMLStyleElement {
    const st = document.createElement('style');
    st.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
      #fab {
        pointer-events: auto; position: fixed; right: 20px; bottom: 20px;
        width: 52px; height: 52px; border-radius: 999px; border: none; cursor: pointer;
        display: grid; place-items: center; color: #fff;
        background: linear-gradient(135deg,#a855f7,#ec4899);
        box-shadow: 0 10px 30px -8px rgba(168,85,247,.6), 0 2px 8px rgba(0,0,0,.3);
        transition: transform .15s ease, box-shadow .15s ease;
      }
      #fab:hover { transform: translateY(-2px) scale(1.04); }
      #panel {
        pointer-events: auto; position: fixed; right: 20px; bottom: 20px;
        width: min(520px, calc(100vw - 40px)); display: none; flex-direction: column;
        background: rgba(17,17,19,.82); backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,.1); border-radius: 18px;
        box-shadow: 0 24px 70px -20px rgba(0,0,0,.7); overflow: hidden; color: #e5e5e5;
        animation: dh-pop .18s ease-out;
      }
      @keyframes dh-pop { from { opacity: 0; transform: translateY(8px) scale(.98);} to {opacity:1;transform:none;} }
      #readout { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; padding: 12px 14px 8px; }
      #date { font-size: 13px; font-weight: 600; color: #fafafa; }
      #msg { font-size: 11px; color: #a3a3a3; margin-top: 2px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #close { background: rgba(255,255,255,.06); border: none; color: #d4d4d4; width: 26px; height: 26px; border-radius: 999px; cursor: pointer; font-size: 18px; line-height: 1; }
      #close:hover { background: rgba(255,255,255,.12); }
      #preview-wrap { margin: 0 12px; border-radius: 10px; overflow: hidden; background: #0a0a0a; border: 1px solid rgba(255,255,255,.06); aspect-ratio: 16/10; display: grid; }
      #preview { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
      #preview-empty { display: none; align-items: center; justify-content: center; color: #737373; font-size: 12px; }
      #routes { display: none; gap: 6px; padding: 10px 14px 0; }
      .chip { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); color: #a3a3a3; font-size: 11px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
      .chip.on { background: rgba(236,72,153,.16); border-color: rgba(236,72,153,.4); color: #fbcfe8; }
      #dial { display: flex; align-items: center; gap: 10px; padding: 12px 14px 6px; }
      .nav { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: #d4d4d4; cursor: pointer; display: grid; place-items: center; }
      .nav:hover { background: rgba(255,255,255,.1); }
      #track { position: relative; flex: 1 1 auto; height: ${THUMB_H + 16}px; overflow: hidden; border-radius: 10px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.05); cursor: grab; touch-action: none; }
      #track:active { cursor: grabbing; }
      #needle { position: absolute; left: 50%; top: 0; height: 100%; width: 0; transform: translateX(-50%); z-index: 3; border-left: 2px solid rgba(236,72,153,.85); }
      #needle::before { content:''; position:absolute; top:0; left:-5px; border-left:5px solid transparent; border-right:5px solid transparent; border-top:6px solid #ec4899; }
      .thumb { position: relative; flex: 0 0 auto; padding: 0; border: none; border-radius: 6px; overflow: hidden; cursor: pointer; outline: 1px solid rgba(255,255,255,.1); background: #1a1a1a; opacity: .7; transition: transform .12s ease, opacity .12s ease, outline-color .12s ease; }
      .thumb:hover { opacity: 1; }
      .thumb.active { opacity: 1; outline: 2px solid #ec4899; transform: scale(1.12); box-shadow: 0 6px 16px -4px rgba(236,72,153,.4); z-index: 2; }
      .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
      .thumb .ph { width: 100%; height: 100%; display: grid; place-items: center; font-size: 8px; color: #737373; font-family: ui-monospace, monospace; }
      #pos { text-align: center; font-size: 10px; color: #525252; font-family: ui-monospace, monospace; padding: 2px 0 10px; }
    `;
    return st;
  }
}

function chevron(dir: 'left' | 'right'): string {
  const d = dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6';
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

/**
 * Mount the overlay once (idempotent). Safe to call from any framework — a
 * React effect, a script tag, or the Vite plugin. No-op during SSR.
 */
export function mountOverlay(opts: { base?: string } = {}): void {
  if (typeof document === 'undefined') return;
  const start = (): void => {
    if (document.getElementById('design-history-overlay')) return;
    new Overlay(opts);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
