---
spec: specs/ui/persistent-sidebar.md
section: SD1
iter: 2
agent: claude-opus-4-8 (independent journey-trace review)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/router.js
  - client/js/contacts.js
  - client/css/style.css
  - client/tests/app.test.js
---

# SD1 iter2 — end-to-end user-journey trace

Focus: trace full user journeys through the actual code paths (not diff-in-isolation).
`npx vitest run client/tests/app.test.js` = 262 passed. No leftover `"contacts"` route
refs in client code (only the IndexedDB store name `"contacts"` remains, unrelated).

## (a) Fresh page load — sidebar populated before navigation — PASS
`initApp()` creates the router at app.js:1295, then calls `renderContactsScreen()`
unconditionally at app.js:1305. `renderContactsScreen()` (app.js:762) guards only on
`if (!list || !empty) return;` — both `#contacts-list`/`#contacts-empty` exist in the
sidebar (index.html:90-91), so it does NOT no-op. `listContacts()` (contacts.js:47) reads
the global `contacts` store — not identity-scoped — so it renders whatever contacts exist
even before identity. Harmless when empty. Confirmed by the new test "populates the
sidebar's #contacts-list immediately after initApp()".

## (b) 1:1 chat start-to-finish — PASS
The message-button flow is a delegated listener registered at app.js:857 on
`el("contacts-list")`. The id is unchanged; the element merely moved into `<aside
id="app-sidebar">` but is still in the DOM at initApp time, so the listener binds. Click →
`getContact()` → `initiateChatSession({ pushToContact })` (app.js:863-864) is untouched by
the route rename. Conversation/room code paths never referenced route `"contacts"`, so the
rename to `"manage"` does not touch them.

## (c) Create group via "+" → manage — PASS
`#btn-sidebar-add` carries `class="...nav-item" data-route="manage"` (index.html:75).
router.js auto-wires every `.nav-item[data-route]` at router.js:17,61-63 — the button lives
in the DOM before `initRouter`, so it is picked up. `"manage"` is in `ROUTES` and
`GATED_ROUTES` (app.js:95-96), so it requires identity (button hidden until identity per
router.js:49 — correct). On navigation, `onScreenChange` fires `renderGroupsCard()` gated to
`route === "manage"` (app.js:1563-1564). Confirmed by the new "+ button navigates to manage"
test and the migrated GC2/GC3 tests.

## (d) Import contact via manage — PASS
`renderImportedContactsScreen()` is gated to `route === "manage"` (app.js:1565). The
`#groups-card`/`#import-card` markup was retained under the renamed `data-screen="manage"`
section (index.html diff; import inputs still present). The Section I2/I3 import tests now
navigate to `#/manage` and pass.

## (e) Proof-check via #btn-check-proofs-now — PASS
Element still exists with that exact id, now in the sidebar (index.html:88). Its handler is
registered at app.js:2723 (`withBusyButton(el("btn-check-proofs-now"), ...)`) — id lookup
unaffected by relocation. The periodic/on-demand `checkContactProofs()` now calls
`renderContactsScreen()` unconditionally (app.js:1267) with the groups/import re-render still
gated to `"manage"` (app.js:1268) — this only re-renders the always-present sidebar list,
harmless.

## (f) Logout / fresh session — PASS
`btn-logout` handler (app.js:1367) clears identity and calls `router.navigate("account")`
(app.js:1399), whose hash change drives `onScreenChange` → unconditional
`renderContactsScreen()` (app.js:1557). On a new session, any navigation (e.g. login →
`room`) likewise re-fires it. `listContacts()` re-queries IndexedDB each call, so data is
fresh, never a cached snapshot. Note (not a regression): the `contacts` store is global, not
identity-scoped (contacts.js:47-50) — the same contact set shows across identities; this
pre-dates SD1.

## NEW observations (evidenced, low severity — not blockers)

1. **Mobile: main pane (incl. account modal) is hidden on fresh load until a hashchange
   sets `body.main-active`.** style.css `@media (max-width:768px)` sets `.app-body > .layout
   { display: none }` with `body.main-active` as the only reveal. On a fresh mobile load no
   hashchange fires (router.js:20-23 resolves the empty hash to `account` WITHOUT rewriting
   the hash — only the gated-redirect branch at router.js:33 rewrites it), so
   `onScreenChange` never runs and `main-active` is never added. The account/welcome-create
   flow therefore depends on the always-visible header `#btn-quick-create`/`#btn-quick-login`
   (app.js:1352-1359), which call `router.navigate("account")` → hash change → `main-active`.
   This works (and the sidebar-first mobile view is intended Telegram-like behavior), but the
   entire mobile reveal hinges on a hashchange actually firing. Worth a live check on both
   hosts that the account modal is reachable on a real phone on first load. Evidence:
   style.css `.app-body > .layout { display: none; }` (mobile block) and `body.main-active
   .app-body > .layout { display: grid; }`.

2. **`onScreenChange` adds `main-active` even when navigating to the `account` modal**
   (app.js:1562, unconditional). On desktop irrelevant (media-query gated). On mobile it
   hides the sidebar behind the account modal — cosmetically fine since account is a
   full-screen overlay. Noted for completeness, not a defect.

## Verdict
All six traced journeys (a)-(f) PASS at the code level; 262/262 tests green. No
correctness break found in the markup/trigger relocation. The only items are the two mobile
responsive observations above, both of which the spec already flags for MANDATORY live
verification on both hosts (spec "Верифікація" section). Recommend that live check
specifically exercise: first-load account creation on a ≤768px viewport, and back/forward
between sidebar and an open conversation.
