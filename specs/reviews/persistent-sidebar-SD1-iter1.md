---
spec: specs/ui/persistent-sidebar.md
section: SD1
iter: 1
agent: claude-opus-4-8 (exec-review subagent)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/css/style.css
  - client/js/router.js
  - client/tests/app.test.js
---

# Exec review — SD1 iter 1 (markup relocation + render-trigger split)

Focus: correctness of the contacts-list relocation into `#app-sidebar`, the
render-trigger split, ROUTES/GATED_ROUTES updates, router auto-wiring, and DOM
integrity. The plan is fixed; findings are bugs, not redesigns.

## Finding 1 (real bug) — desktop back-button never hidden

- File: `C:\claude\spirit\.claude\worktrees\agent-a8da6501a8bb10f54\client\css\style.css`
- Line: 201 (and 205)
- Quote: `#btn-sidebar-back {` `display: none;`
- Description: The only rules that set `#btn-sidebar-back { display: none }`
  and its `body.main-active` reveal live **inside** the
  `@media (max-width: 768px)` block. Outside that breakpoint there is no rule
  hiding it, and `.btn-icon` (style.css:406) sets no `display`, so a `<button>`
  defaults to visible. On desktop (>768px) the "← Назад" affordance is
  therefore always rendered at the top of `<main class="layout">`. This
  directly contradicts the index.html comment (line 97): "hidden on desktop via
  CSS". Fix: add a base rule `#btn-sidebar-back { display: none; }` outside the
  media query, and only re-show it inside the mobile block under
  `body.main-active`.

## Items verified correct (no finding)

1. `#app-sidebar` is a genuine sibling of `<main class="layout">`: both are
   direct children of `<div class="app-body">` (index.html ~L66–104), outside
   every `[data-screen]` element. `.app-body` opens after the top-bar `</div>`
   and closes after `</main>`.
2. `#contacts-list`, `#contacts-empty`, `#btn-check-proofs-now`,
   `#proofs-check-status` are **moved**, not duplicated — the old
   `data-screen="contacts"` card containing them is gone; `data-screen="manage"`
   now holds only `#groups-card`/`#import-card`. Original `id`s preserved
   verbatim. No duplicate ids; no dangling references.
3. Render-trigger split correct in both places: `renderContactsScreen()` is
   now called unconditionally in the periodic proof-check callback (app.js
   ~L1263) and in `onScreenChange` (~L1556); `renderGroupsCard()` /
   `renderImportedContactsScreen()` remain gated on `route === "manage"` in
   both. Startup call `renderContactsScreen();` added right after router
   creation, before first render (app.js ~L1303).
4. `ROUTES` / `GATED_ROUTES`: `"contacts"` → `"manage"` in both app.js (L95–96)
   and the test mirror (test L217).
5. `router.js` is unmodified. Its `.nav-item[data-route]` querySelectorAll
   auto-wiring genuinely picks up `#btn-sidebar-add` (class="nav-item"
   data-route="manage") with zero custom click JS — confirmed by reading
   router.js and the new passing test.
6. `#settings-menu`'s `data-route="contacts"` nav item is removed from
   index.html; test HTML filters it out and asserts its absence.
7. CSS `.app-body` wraps both as flex siblings; mobile stacking via
   `.main-active` toggle is plausible aside from Finding 1. `body.main-active`
   restores `.layout` to `display: grid`, matching its base display type.
8. Test fixture `#app-sidebar` mirrors real structure (sibling of data-screen
   sections, same moved ids) — tests are meaningful, not trivially passing.
   New tests assert startup population, `+`-button nav to `manage`, and removal
   of the contacts nav item.

## Verdict

One real, user-visible CSS bug (Finding 1). Everything else in the SD1
markup-relocation / render-trigger scope is correct.
