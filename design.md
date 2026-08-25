# design-history — Design System

Extracted to match the visual language of [agentation.com](https://www.agentation.com): a warm, near-white, **technical-documentation** aesthetic. Small, tight, dense type; an editorial serif headline over a clean sans; ink expressed as black at alpha steps; a single blue primary; hairline-ring cards; quiet, fast micro-interactions.

The page chrome follows this system. The embedded product mockups (the dial, the FAB) keep the product's own dark UI and fuchsia→amber accent — legitimate "screenshots" inside an otherwise light, agentation-style page.

---

## Color

Ink is **black at alpha steps** (not separate greys) — the defining trick of this palette. Surfaces are warm near-whites; one blue is the primary; red / violet / green appear only as small semantic accents.

### Light (default)

| Token | Value | Use |
|---|---|---|
| `--ground` | `#FDFDFC` | page background (warm near-white) |
| `--surface` | `#FFFFFF` | cards, raised panels |
| `--surface-subtle` | `#F6F5F4` | inset / secondary cards |
| `--surface-dark` | `#1A1A1A` | dark chips, code, product "screens" |
| `--ink-900` | `rgba(0,0,0,0.85)` | headings |
| `--ink-800` | `rgba(0,0,0,0.78)` | subheads / strong body |
| `--ink-700` | `rgba(0,0,0,0.65)` | body text |
| `--ink-500` | `rgba(0,0,0,0.50)` | secondary |
| `--ink-400` | `rgba(0,0,0,0.35)` | muted / captions |
| `--hairline` | `rgba(0,0,0,0.06)` | 1px borders, ring shadows |
| `--hairline-strong` | `rgba(0,0,0,0.10)` | hovered / emphasized borders |
| `--blue` | `#2480ED` | links, primary accent |
| `--blue-solid` | `#3C82F7` | primary button fill |
| `--violet` | `#7C3AED` | secondary accent |
| `--red` | `#E5484D` | version badges, alerts |
| `--green` | `#22C55E` | success / status |

### Dark (mirror — keep contrast legible)

| Token | Value |
|---|---|
| `--ground` | `#0E0E0F` |
| `--surface` | `#161617` |
| `--surface-subtle` | `#1C1C1E` |
| `--ink-900` | `rgba(255,255,255,0.92)` |
| `--ink-700` | `rgba(255,255,255,0.70)` |
| `--ink-500` | `rgba(255,255,255,0.50)` |
| `--ink-400` | `rgba(255,255,255,0.38)` |
| `--hairline` | `rgba(255,255,255,0.09)` |
| `--blue` | `#5AA2F5` |

---

## Typography

Three families. The **serif headline** is the signature — everything else is small, tight Inter.

- **Display / headings** — `"IBM Plex Serif", Georgia, serif` · weight **500** · `font-style: normal`
- **Body / UI / labels** — `Inter, system-ui, -apple-system, sans-serif`
- **Code / data** — `ui-monospace, "SF Mono", SFMono-Regular, "IBM Plex Mono", monospace`

Load from Google Fonts: `IBM Plex Serif:wght@400;500;600` and `Inter:wght@400;450;500;550;600` (450/550 are real Inter variable weights — use them).

### Scale (small and tight)

| Role | Family | Size | Weight | Line-height | Tracking |
|---|---|---|---|---|---|
| Hero H1 | IBM Plex Serif | 32–46px (clamp) | 500 | 1.15 | −0.005em |
| Section title | IBM Plex Serif | 22–26px | 500 | 1.2 | −0.01em |
| Section label (H2) | Inter | 13px | 550 | 1.3 | −0.006em |
| Body | Inter | 14–15px | 400–450 | **1.65** | −0.006em |
| Small / caption | Inter | 12–13px | 450 | 1.5 | −0.004em |
| Eyebrow | Inter | 9–10px | 500 | 1 | **+0.16em**, `uppercase` |
| Code | mono | 12.5–13px | 400 | 1.5 | 0 |

Keep body measure ≈ 68ch. Do **not** scale hero type large — agentation's H1 is only 32px; the restraint is the point.

---

## Spacing & layout

- **Content width:** `max-width: 940px`, centered, `padding: 0 24px`.
- **Section rhythm:** compact — `56–72px` vertical between sections (not 100px+). Agentation uses ~32px between tightly-related blocks; give a bit more between major sections.
- **Grid gaps:** `12–16px` between cards.
- **Density:** this is a docs page — prefer more, smaller elements over few large ones. Left-align everything; avoid centered hero blocks except the single hero.

---

## Radii

A tight scale: **6 / 8 / 10 / 12 / 16 px**.
- Chips, code inline: `6px`
- Buttons, small cards: `8px`
- Cards: `10–12px`
- Large feature panels: `16px`

---

## Borders & shadows

Hairlines, not heavy borders. Cards get a **ring + soft lift**, never a hard border.

- Hairline border: `1px solid var(--hairline)`
- Card (default): `box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.08)`
- Card (subtle): `box-shadow: 0 1px 2px rgba(0,0,0,.04)`
- Dark chip: `box-shadow: 0 2px 8px rgba(0,0,0,.25)`

---

## Motion & micro-interactions

Quiet and quick. The signature easing is **`cubic-bezier(0.22, 1, 0.36, 1)`** (ease-out-expo-ish).

- **Durations:** `0.15s` for color, `0.2s` for background/opacity, `0.25s` for transform/reveal.
- **Links / text:** `transition: color 0.15s`. On Inter (variable), agentation also eases `font-variation-settings 0.25s` — subtle weight shift on hover is on-brand.
- **Buttons:** `transition: background-color 0.2s, transform 0.15s, box-shadow 0.2s`; hover raises `translateY(-1px)` and deepens the shadow slightly.
- **Cards:** hover lifts `translateY(-2px)` with the ring→stronger shadow, `0.2s`.
- **Scroll reveals (optional):** `opacity 0.25s, transform 0.25s cubic-bezier(0.22,1,0.36,1)`, small `translateY(8px)` start. Use sparingly.
- Respect `prefers-reduced-motion: reduce` — drop transforms/animations.

---

## Component patterns

**Top nav** — sticky, hairline bottom border, `backdrop-filter: blur`. Small (13–14px) Inter links in `--ink-500`, hovering to `--ink-900`. Wordmark left; grouped links right.

**Eyebrow** — tiny uppercase Inter, `+0.16em` tracking, colored (`--red` for version/status, `--ink-400` for section kickers). Sits above a title.

**Primary button** — `--blue-solid` fill, white text, `8px` radius, `13–14px`/weight 550, padding `~9px 16px`. Hover: slight lift + shadow.

**Secondary button** — `--surface` fill, `1px var(--hairline-strong)` ring, `--ink-800` text. Hover: `--surface-subtle`.

**Install command** — a white card, `8px` radius, subtle shadow; `$` prompt in `--ink-400`, command in mono `--ink-900`, a quiet "copy" affordance right-aligned.

**Card** — white, `10–12px` radius, ring+soft shadow; a small icon tile (`--surface-subtle` bg, blue glyph), a 13px title, 14px `--ink-700` body.

**Numbered step** — a dense two-column row (number in serif or mono, `--ink-400`; content right), separated by hairline dividers — matching agentation's "How you use it" list.

**Code / terminal block** — `--surface-dark` (`#1A1A1A`), `10px` radius, mono, syntax in restrained accent colors (blue keyword, `--ink-400` comments, green string).
