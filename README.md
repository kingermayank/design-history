# design-history

**Visual git history for designers.** Figma keeps every version on an infinite canvas. Your codebase doesn't — every commit overwrites how the product *looked*. design-history reconstructs and records that visual history: a screenshot of every commit, browsable on a time-travel dial, in a standalone viewer or a floating button right inside your running app.

- ⏳ **Backfill** any existing repo — replay your whole commit history and screenshot each version
- 📸 **Auto-capture** on every future commit (non-blocking git hook)
- 🎚️ **Time-travel dial** — scrub back and forth through versions, per route, mobile + desktop
- 🔘 **In-app button** — a floating FAB in your dev app that expands into the dial (Vite)
- 💾 **Local-first** — everything lives in `.design-history/`, no cloud, no account

---

## Install

```bash
npm i -D design-history
npx design-history init
```

`init` writes a config, installs a non-blocking `post-commit` hook, and — if you use Vite — tells you how to add the in-app button.

## Reconstruct your history

```bash
npx design-history backfill
```

This replays every commit: it checks out each one in an isolated worktree, boots your dev server **once**, and hot-swaps the source underneath it (`git checkout` → the dev server's own watcher recompiles → screenshot). Per commit is ~2–4s; the whole thing is minutes, not hours.

> On a real 74-commit Vite + Storybook + Supabase app, a full run (2 routes × mobile+desktop = ~288 screenshots) takes **~9 min cold**, **~4–5 min** with the install cache warm.

## Browse it

**Standalone viewer:**
```bash
npx design-history view
```

**Or the in-app floating button** (Vite): add the plugin, then just run your dev server.
```ts
// vite.config.ts
import designHistory from 'design-history/vite'

export default defineConfig({
  plugins: [react(), designHistory()],
})
```
A round button appears bottom-right of your app in dev. Click it to open the time-travel dial. It's dev-only and injects nothing into production.

---

## Configuration

```js
// design-history.config.js
export default {
  devServer: 'http://localhost:5173',

  routes: [
    { path: '/', label: 'Home' },
    { path: '/pricing', label: 'Pricing' },
    // dynamic routes: pass a concrete, history-stable URL (e.g. an id, not a slug)
    { path: '/listing/10b2efa4-…', label: 'Listing', waitFor: 3000 },
  ],

  viewports: [
    { name: 'mobile',  width: 390,  height: 844 },
    { name: 'desktop', width: 1440, height: 900 },
  ],

  waitFor: 'networkidle',          // 'networkidle' | 'load' | selector | ms

  // Used by backfill when replaying old commits:
  installCommand: 'npm install',   // e.g. 'npm install --legacy-peer-deps' for strict peer conflicts
  startCommand: 'npm run dev',     // the tool reads the URL your server prints — no port flag needed
  serverReadyTimeoutMs: 60000,

  installCache: true,              // reuse node_modules across identical lockfiles (CoW clones)
  skip: { enabled: true },         // skip commits whose diff is entirely non-visual (docs/tests/config)
}
```

## Commands

| Command | What it does |
|---|---|
| `design-history init` | Config, git hook, gitignore, Vite-plugin guidance. |
| `design-history backfill` | Replay past commits into screenshots. `--limit N`, `--from <sha>`, `--branch <name>`. |
| `design-history view` | Open the standalone timeline viewer. |
| `design-history capture` | Capture the current commit (used by the hook). |
| `design-history snap [label]` | Ad-hoc capture for a moment that isn't a commit. |
| `design-history auth` | Save cookies/localStorage for routes behind login. |
| `design-history cache clear` | Delete the cached `node_modules` trees. |

## How it works

- **Capture** uses [Playwright](https://playwright.dev) headless Chromium, at each configured route × viewport.
- **Backfill** reads the URL your dev server prints on stdout (frameworks pick their own port), keeps one server alive, and `git checkout`s each commit underneath it — the watcher recompiles, then it screenshots. Config/lockfile changes trigger a restart; a lockfile-keyed copy-on-write cache keeps reinstalls fast.
- **Non-visual commits** (docs, tests, config-only diffs) are auto-skipped and shown as "no visual change since …".
- **The viewer / FAB** are pure clients over `.design-history/manifest.json` + the PNGs.

## Honest limitations

- Very old commits may fail to `npm install` (dependency drift) or fail to boot — those are logged and skipped; the run continues.
- **Dynamic routes whose URL scheme changed over time** (e.g. id → slug) won't resolve on every commit. Use the most history-stable URL; some old commits may render a not-found page. That's accurate history, not a bug.
- `.env` / DB state isn't time-traveled — backfill sees what's on disk now.

## License

MIT
