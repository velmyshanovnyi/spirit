---
spec: specs/ui/room-first.md
section: RF5 — minimal header on the conversation route
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/js/i18n.js
  - client/js/locales/*.js
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: FAIL — 1 finding, fixed in iter2

## F1 — the quick-settings slot was a `.nav-item`
`client/js/app.js` settings-menu item handler: `if (event.target.closest(".nav-item")) closeSettingsMenu();`
With `#lang-select`/`#theme-toggle` reparented into a `.nav-item` slot, any
click on them (the native select fires click on open) closed the menu —
language picking unreliable, theme toggle closed the menu each time.
**Fixed:** slot class `menu-quick-settings` (no `nav-item`); test opens the
menu, clicks the select and the toggle, asserts it stays open (RED-proven).

## Checks that passed
Reparent restores lang → theme → settings-wrap (anchor = the whitespace node
before `.settings-wrap`); inline `order` from headerControlsOrder travels
with the nodes (harmless inside the slot); no call of
`setConversationChromeVisible` precedes the captured consts; outside-click
uses `settingsMenu.contains`; a11y acceptable; `lang-select` options built
once by id; `account` in ROUTES, not gated/advanced → reachable for an
ephemeral user; spec wording matches.

Tests: app + i18n 428/428.
