---
name: design-history
description: Set up design-history on the current project — reconstruct the app's visual git history as screenshots and add an in-app time-travel dial. Use when the user wants to backfill/see how their UI evolved across commits, add the floating design-history button, or install/configure design-history in a repo.
---

# Setting up design-history on a project

Goal: get this project capturing a screenshot of every commit and browsable on the time-travel dial — the standalone viewer and (for Vite apps) the in-app floating button.

Work through these steps, adapting to what you find. Confirm before the slow backfill step.

## 1. Preconditions
- Confirm it's a git repo with commits (`git rev-parse --is-inside-work-tree`, `git rev-list --count HEAD`). If not, stop and tell the user.
- Confirm design-history is available (`npx design-history --version`). If not: `npm i -D design-history`.

## 2. Initialize
- Run `npx design-history init`. This writes `design-history.config.js`, a non-blocking post-commit hook, and gitignore entries.

## 3. Configure — this is the part that needs judgement
Open `design-history.config.js` and set:
- **devServer**: the URL the dev server actually serves on. Read `package.json` scripts and any framework config to determine it (Vite defaults to 5173, Next/CRA to 3000). You do NOT need a port flag in `startCommand` — the tool reads the URL the server prints.
- **routes**: inspect the router (e.g. `src/App.tsx`, a routes file, or the framework's file-based routing). Add the key pages the user cares about. For **dynamic routes** (`/thing/:id`), pass a concrete, history-stable URL — prefer an **id** over a slug, because slug schemes often changed partway through history and will 404 on older commits. Give data-heavy routes a fixed `waitFor` (e.g. `3000`) if the app holds an open socket (Supabase realtime, websockets) that prevents `networkidle`.
- **installCommand**: if the project has peer-dependency conflicts (common with Storybook), set `'npm install --legacy-peer-deps'`. Detect by checking whether a plain install resolves.
- **startCommand**: usually `'npm run dev'` (or the project's dev script).

## 4. In-app button (Vite projects only)
If a `vite.config.{ts,js,mjs}` exists, add the plugin:
```ts
import designHistory from 'design-history/vite'
// plugins: [ ...existing, designHistory() ]
```
Then the FAB appears bottom-right when the user runs their dev server. Skip for non-Vite projects (the CLI viewer still works).

## 5. Reconstruct history (slow — confirm first)
- Tell the user the estimate: ~2–4s per commit plus `npm install` time at each lockfile change; a typical project is a few minutes. Confirm before running.
- Run `npx design-history backfill` (offer `--limit N` to sample first). It's resumable and isolates per-commit failures.
- Report the tally (captured / skipped / failed). Old commits that can't install or boot are expected to fail — that's logged, not fatal.

## 6. Browse
- `npx design-history view` for the standalone viewer, or have the user start their dev server to see the in-app button.

## Notes
- Everything lives in `.design-history/` (gitignored by default).
- If backfill fails to reach the dev server, the cause is usually the wrong `devServer` URL or a `startCommand` that doesn't start the server — verify by booting it manually once.
