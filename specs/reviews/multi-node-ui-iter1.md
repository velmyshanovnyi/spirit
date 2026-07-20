---
spec: phase4/multi-node-ui
section: multi-node-ui (single-section spec)
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/app.test.js
  - specs/phase4/multi-node-ui.md
---

Focus: does selecting a saved node correctly populate the three fields without side effects;
is localStorage read/write handled safely (corrupted JSON, storage throwing); does the empty-list
default state leave existing `#server-url`/`#stun-url`/`#force-turn-relay` behavior unchanged;
general correctness of `renderSignalingNodesList`/save/delete handlers and i18n parity across all
11 locales; test quality of the new "multi-node signaling UI" describe block.

Five checks performed:

1. **Select-node side effects** -- no findings. The `[data-signaling-node-select]` handler only
   sets `#server-url.value`, `#stun-url.value`, `#force-turn-relay.checked`, then returns. No
   reconnect, no session/state mutation, no event dispatch.

2. **localStorage safety** -- no findings. `loadSignalingNodes` wraps `getItem`+`JSON.parse` in
   try/catch, returns `[]` on throw, and coerces non-array parse results to `[]`.
   `saveSignalingNodes` wraps `setItem` in try/catch. Matches the established `spirit.welcomeSeen`
   fail-open pattern already in `app.js`. Malformed-JSON test confirms no throw.

3. **Empty-list default state** -- no findings. `renderSignalingNodesList()` runs unconditionally
   at init but only writes to the new `#signaling-nodes-list`/`#signaling-nodes-empty` elements,
   never touching the three existing fields. Test asserts byte-for-byte unchanged defaults.

4. **Correctness / i18n** -- one minor finding, fixed before commit:
   - All 5 new i18n keys (`infra.savedNodesHeading`, `infra.savedNodesEmpty`,
     `label.signalingNodeName`, `btn.saveSignalingNode`, `btn.deleteSignalingNode`) confirmed
     present in all 11 locale blocks (grep count = 11 for each).
   - Node data rendered via `textContent`, not `innerHTML` -- no XSS from stored name/url.
   - **Finding (fixed)**: `renderSignalingNodesList` assumed every stored array element has a
     string `serverUrl`/`name`; a hand-edited or foreign localStorage array element missing
     those fields would throw inside render and break the whole Server screen -- the exact
     failure mode the storage-level try/catch is meant to prevent. Low severity (unreachable via
     the app's own save handler, which always writes the full shape), but fixed anyway: added a
     `typeof node.serverUrl === "string"` guard defaulting to `""`, and `node.name ?? ""`, so a
     malformed element degrades to a blank label instead of throwing.
   - Minor style note (not fixed, cosmetic only): `randomSignalingNodeId` uses the bare `crypto`
     global while storage access goes through `doc.defaultView.localStorage`; both work in
     browser and jsdom, dismissed as non-functional.

5. **Test quality** -- no findings. Six non-tautological tests drive real DOM clicks and assert
   observable state: empty-list defaults, save (stored shape + list render + name-field clear),
   select (field population from a pre-seeded 2-node store), delete (DOM + localStorage),
   multi-node coexistence with independent delete, and malformed-JSON fail-open.

**Outcome**: converged on iteration 1. One real finding (missing per-element shape guard in
render), fixed inline; re-ran the fix through the reviewed test suite in full (see below) to
confirm the fix introduced no regression, no second review iteration required since the fix
was mechanical (fallback to empty string) and directly covered by the existing malformed-JSON
test's intent.

Full suite: 676/676 passing (670 pre-existing + 6 new "multi-node signaling UI" tests).
