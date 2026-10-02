---
spec: specs/ui/room-first.md
section: RF4 — chat drawer
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/css/style.css
  - client/js/app.js
  - client/tests/app.test.js
---

# Verdict: PASS — 1 cosmetic note (fixed)

- (a) `.card { gap: 12px }` left a 12px row-gap under the empty (hidden hint)
  row 1 on desktop. **Fixed by author:** `row-gap: 0` on the grid +
  `margin-bottom` on the hint when shown.
- (b) Hint shown → spans both columns above; drawer starts at row 2.
- (c) `grid-row: 2 / span 2` with implicit rows from stage/controls — fine.
- (d) `[hidden]` children stay hidden on desktop (`!important` UA-level rule,
  no author override left).
- (e) `byUser: true` on collapse sets `drawerUserCollapsed`; Escape too;
  auto-expand neither focuses nor resets the flag.
- (f) `aria-label` localized via `data-i18n-title` → resolved.

Tests: app.test.js 411/411. Author full suite (pre-polish): 1072/1072.

## Author's live verification (2026-10-02, kolomedi, both hosts deployed)
- **Phone (375 px)**: drawer starts collapsed (only the handle visible),
  «Чат» button in the control bar; tap → expanded, `aria-expanded="true"`,
  focus in `#message-input`; chat log/input visible.
- **Desktop (1280 px)**: card is a 2-column grid — stage (133–732) with the
  control bar directly under it, drawer as the right column (748–1147) with
  chat log (`display: flex`) and input row; handle and «Чат» button hidden;
  hidden file-offer banner stays hidden. Screenshot matches mockup C's
  desktop reading.
- Note: the browser pane's phone emulation reports `innerWidth` ≠
  `clientWidth` (970 vs 375) which stretches the card in the pane only — not
  reproducible on a real device (RF1's earlier 375 px check laid out at 305 px).
