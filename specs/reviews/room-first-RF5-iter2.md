---
spec: specs/ui/room-first.md
section: RF5 — minimal header on the conversation route
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: PASS — 0 findings (delta of the iter1 fix)

- (a) Nothing else keys off `.nav-item` in a way the slot needs
  (`router.js` uses `.nav-item[data-route]`; the rest is styling).
- (b) Outside-click still treats the slot as inside the menu.
- (c) `select.click()` bubbles to the item handler; would fail with the old
  class — consistent with the author's RED.
- (d) Slot padding 8px 12px vs nav items 8px 14px (desktop) — nit only.

Tests: RF5 3/3. Author full suite: 63 files, 1075/1075.

## Author's live verification (2026-10-02, kolomedi; both hosts deployed)
Conversation route: `body.room-chrome`, brand text `display: none` (logo
only), gear hidden / «⋯» shown (`data-icon="more"`), `#lang-select` inside
`#settings-menu`; opening the menu shows the language select + theme toggle
on top, then «Зберегти акаунт» (ephemeral identity) and the rest of the
items (advanced mode was unlocked in that browser profile). Screenshot
matches mockup C's header. Switching route restores the header (unit-tested).
