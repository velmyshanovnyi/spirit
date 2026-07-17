---
spec: ui/chat-first-redesign
section: H4
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/js/i18n.js
  - client/tests/app.test.js
---

Two findings, both required fixes before commit:

**1. CONFIRMED (higher severity) — z-index collision hides the welcome modal.** `.modal-screen` used `z-index: 100`, identical to the H1 `.modal-overlay`. Since `defaultRoute` is `"account"`, EVERY first-time visitor with no identity yet lands on the account screen (now a full-screen fixed overlay) AND sees the welcome modal at the same time -- this is guaranteed co-occurrence, not a rare edge case. With equal z-index, the account modal (later in the DOM) painted on top, its opaque backdrop covering the welcome modal's confirm button -- the user couldn't dismiss the welcome modal, so `spirit.welcomeSeen` never persisted and it stayed stuck behind the account modal on every visit. Fixed: `.modal-screen`'s z-index lowered to 99 (below H1's 100, below H2's settings-menu 101).

**2. CONFIRMED (minor) — desktop card width bug.** The new `.modal-screen > .card { max-width: 420px }` (specificity 0,2,0) lost on viewports ≥768px to the pre-existing `.screen > .card:only-of-type:not(.card-wide) { max-width: 520px }` (specificity 0,4,0) -- the desktop modal card rendered 100px wider than intended, since `grid-column`/`justify-self` from the older rule are inert under `display:flex` but `max-width` still conflicts. Fixed: added `!important` to the new rule's `max-width`, with a comment narrowly justifying the override (the older rule targets a different layout mode, not this fixed-overlay modal).

Non-defects confirmed during this pass:
- `router.js`'s `navigate()` runs `render()` synchronously and the gate redirect resolves in-call -- `btn-account-close`'s unconditional `router.navigate("conversation")` when no identity exists is a correct, synchronous no-op (stays on "account").
- Accessibility bar matches H1's accepted MVP gap: `aria-label="Close"` + `data-i18n-title` present, no Escape/focus-trap (consistent, not silently worse).
- Test fixture doesn't exercise the CSS presentation (jsdom doesn't run layout) -- acknowledged gap matching the project's established pure-markup-change pattern, closed by live verification.

Convergence: not reached, iteration 2 required after fixes.
