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

That's the whole setup. The first time it captures, design-history downloads its headless browser automatically (a one-time ~150 MB Chromium) — no `playwright install` step to remember.

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

**Or the in-app floating button** — a round button appears bottom-right of your running app; click it to open the time-travel dial. `init` detects your framework and prints the exact one-liner. It's dev-only and injects nothing into production.

**Next.js, Remix, Create React App, or any React app** — add the component once to your app root:
```tsx
// app/layout.tsx (Next.js) · app/root.tsx (Remix) · src/index.tsx (CRA)
import { DesignHistory } from 'design-history/react'

// …then render it near the end of <body>:
<DesignHistory />
```

**Vite** — add the plugin (auto-injects, no component needed):
```ts
// vite.config.ts
import designHistory from 'design-history/vite'

export default defineConfig({ plugins: [react(), designHistory()] })
```

**Anything else (SvelteKit, Astro, plain HTML)** — a script tag:
```html
<script type="module" src="/__design-history/overlay.js"></script>
```

`init` sets up a `public/__design-history` symlink so the captured history is served to the button automatically — no extra server, no separate port.

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
| `design-history init` | Config, git hook, gitignore, framework detection for the in-app button. |
| `design-history backfill` | Replay past commits into screenshots. `--limit N`, `--from <sha>`, `--branch <name>`. |
| `design-history watch` | Attach to your **already-running** dev server and capture on each commit — no boot, unfailable. `--interval <sec>` also snaps while you iterate. |
| `design-history replay` | Render your history into a shareable **MP4** (or `--gif`). `--route`, `--viewport`, `--per-frame <ms>`. |
| `design-history view` | Open the standalone timeline viewer. |
| `design-history capture` | Capture the current commit (used by the hook). |
| `design-history snap [label]` | Ad-hoc capture for a moment that isn't a commit. |
| `design-history auth` | Save cookies/localStorage for routes behind login. |
| `design-history mcp` | Start an MCP server so agents can query your visual history (stdio). |
| `design-history cache clear` | Delete the cached `node_modules` trees. |

### Two shortcuts worth knowing

**`watch` — the zero-risk first run.** Already have `npm run dev` going? Just:
```bash
npx design-history watch
```
It attaches to that server (no worktree, no install, no boot), captures your live app immediately, then re-captures on every commit. Nothing to fail.

**`replay` — the thing you post.** Once you've got history:
```bash
npx design-history replay              # → .design-history/replay.mp4
npx design-history replay --gif        # → a shareable GIF
```
One frame per version, oldest → newest. Your interface rebuilding itself in fast-forward.

**`mcp` — let your agent see the past.** Point Claude or Cursor at your history:
```jsonc
// e.g. .cursor/mcp.json or Claude Desktop config
{ "mcpServers": {
    "design-history": { "command": "npx", "args": ["design-history", "mcp"] }
} }
```
The agent gets three tools — `list_versions`, `get_screenshot` (returns the actual image), and `get_diff` — so *"what did the homepage look like before the redesign, and what changed?"* becomes answerable.

## Diff & restore, in the viewer

Open the viewer and hit **Diff & restore** on any version to see the exact code that produced that screenshot — files changed, the full patch — and **Restore** it with one click (creates a branch; never touches your working tree).

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
