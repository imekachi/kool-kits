# Product

## Register

product

## Users

Individual Chrome users running the Kool Kits extension for small, focused browser-workflow upgrades. For the Meeting Reminder feature specifically: someone signed into Google Calendar in their browser who wants today's meetings visible at a glance from the toolbar, without opening the Calendar tab. They are mid-task in the browser; the popup is a 2-3 second glance ("what's now, what's next, how do I join"), not a place they dwell.

## Product Purpose

Kool Kits adds focused behaviors that make repeated browsing actions faster, clearer, or more pleasant. It is not a browser replacement. Each feature is independently understandable, testable, and releasable. The Meeting Reminder surfaces today's calendar meetings as a toolbar badge (red urgency countdown) and a popup that shows in-progress and upcoming meetings with one-click join. Success: the user trusts the badge enough to stop watching the clock, and the popup answers "now / next / join" in one glance.

## Brand Personality

Calm, precise, native. The extension should feel like it belongs in Chrome, not like a third-party app bolted on. Three words: focused, trustworthy, quietly polished. The UI earns confidence through accuracy (the countdown is right, the account shown is the one being read) rather than through decoration. Delight lives in small moments (a clean countdown, a satisfying toggle), never in pages that ask to be admired.

## Anti-references

- Not a marketing surface: no hero metrics, no gradient text, no eyebrow kickers, no animated page-load choreography.
- Not a heavy productivity dashboard: no dense data grids, no nested cards, no chrome-heavy chrome.
- Not a generic SaaS settings page: no flat list of evenly-weighted rows with a bare status sentence.
- Not OS-foreign: avoid invented affordances for standard tasks (custom dropdowns, weird toggles).

## Design Principles

- **The popup answers one question fast.** Now, next, join. Hierarchy serves the glance: the most urgent meeting dominates; everything else recedes.
- **Accuracy is the brand.** The countdown, the in-progress flip, and the connected account must always be visibly correct; the user trusts the badge because the popup never lies.
- **Native over novel.** Reuse standard affordances and the system's visual grammar. The tool disappears into the task.
- **Color carries meaning, not decoration.** Yellow marks primary actions and brand identity; red means urgency only; green means connected. No accent used for flavor.
- **Every state is designed.** Empty, not-connected, error, loading, disabled are first-class screens that teach the interface, not afterthoughts.

## Accessibility & Inclusion

- WCAG AA contrast: body text >=4.5:1, large/bold text >=3:1, against the dark panel. Muted text colors must clear 4.5:1, not drift into low-contrast gray.
- Color is never the sole signal: urgency (red) is paired with countdown text and an "in progress" / "now" label; connection (green) is paired with the account email and status word.
- Full keyboard support and visible focus rings on every interactive control (toggle, selects, Join, Settings, Connect).
- `prefers-reduced-motion`: countdown bars and state transitions degrade to instant/crossfade.
- Dark theme by default with `color-scheme: dark`.

## Visual System (locked)

- Palette: navy `#1d1b3a`, off-white `#fffaf0`, yellow `#ffd23f` (primary actions + brand), red `#e5484d` (urgency only), green (connected status). Dark panels.
- Type: Inter, self-hosted as a bundled `woff2` with `@font-face` (never loaded from a remote CDN: no network call on popup open, works offline, no third-party egress). Fixed rem scale, not fluid.
- Logo: navy rounded square, off-white "K" + yellow dot (`icons/icon*.png`). Used in the options header.
