---
spec: specs/ui/room-first.md
section: RF4 — chat drawer
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: FAIL — 1 finding + 2 advisories; all addressed in iter2

## F1 — auto-expand stole focus
`client/js/app.js` setChatDrawer: `el("message-input")?.focus();` ran on the
incoming-message auto-expand too → keystrokes in another field jump to the
chat box, on-screen keyboard pops over the stage. **Fixed:** focus only when
`byUser`; test focuses `#nickname-input` before the incoming offer and
asserts `activeElement` unchanged (RED-proven).

## Advisory — `display: revert` at ≥900px
Fragile: discards author `display` on children (`.chat-log` flex → block,
confirmed live) and could override `[hidden]`. **Fixed:** the collapsed rule
is scoped to `@media (max-width: 899.98px)`; the revert block removed.

## Advisory — hardcoded `aria-label="Чат"`
Resolved in iter2: `applyTranslations` sets `aria-label` from
`data-i18n-title`, which the button carries.

## Author's own live finding (same iteration)
Desktop grid auto-placement dropped `#room-controls` into the right column.
**Fixed:** explicit placement (hint row 1 spanning both columns; stage col 1
row 2; controls col 1 row 3; drawer col 2 rows 2–3).

## Checks that passed
Markup move (no id lost/duplicated; hint above stage); group-history replay
does not trigger the drawer (hook is at the live receive sites only);
tests non-vacuous; no new i18n keys.

Tests: app.test.js 411/411.
