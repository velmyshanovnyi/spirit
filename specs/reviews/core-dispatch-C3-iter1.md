---
spec: specs/phase5/core-dispatch.md
section: C3 — group/mesh handlers → groupChatHandlers.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/groupChatHandlers.js
  - client/js/app.js
  - client/tests/groupChatHandlers.test.js
  - specs/phase5/core-dispatch.md
---

# Verdict: PASS — 0 findings

1. **Verbatim** — bodies of broadcastGroupMemberJoined, ensureLocalGroupRecord,
   onGroupMemberJoined, onGroupMessage, onMeshRelay match line by line at the
   same indent; comment paragraphs stayed with their functions; the module
   table carries the same four keys the app.js table lost.
2. **TDZ** — init at app.js:1781; `t` (import), `state` (349), `getActivePeer`
   (479), `appendGroupChat` (788), `noteIncomingForDrawer` (967) above. Mesh
   primitives are consts from initGroupMesh (2161–2166) below; thunks are
   only invoked from message handlers; thunk arity matches every call site
   (one object / control / (control, connectionId) / control).
3. **Returned helpers** — ensureLocalGroupRecord (1970) and
   broadcastGroupMemberJoined (1974) in onIdentityAnnounce, plus the
   initGroupMesh injection (2174), all after the init line.
4. Module identifiers resolve; `state.*` via the shared object.
5. Pruning — groups.js import now `updateGroupMembers` only (still used);
   getContact still used.
6. Tests non-vacuous (note: vault branch covered by app.test.js, not here).
7. Spec ↔ code match.

Tests: groupChatHandlers + app + groupMesh 423/423. Author full suite:
66 files, 1088/1088.

## Author's live verification (2026-10-03; app.js 153491 B, groupChatHandlers.js 10574 B byte-identical on both hosts)
kolomedi + kibr: module in Resource Timing, `__spiritControlHandlers` has 16
keys, the four group/mesh keys are functions and the mesh pair maps to one
handler; no console errors.
