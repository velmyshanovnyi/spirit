---
spec: specs/phase4/group-chats.md
section: GC3
iter: 2
agent: opus (exec-review)
files-reviewed:
  - client/js/app.js
---

# GC3 exec-review — iteration 2

## Status: CONVERGED

No new findings. Both iter1 findings are closed.

## Verification of iter1 findings

### MEDIUM (iter1): onMessage activeConnectionId rebinding not await-safe across overlapping connections — CLOSED

`wireChannelCallbacks.onMessage` (app.js ~1836-1897) is rewritten to chain
every call onto a single shared `state.messageDispatchLock` queue
(initialized `Promise.resolve()` at app.js ~281). Verified:

- **Serialization is app-wide.** The queue field is on `state`, not per-connection,
  so tasks from different connections chain onto the same promise — at most one
  message body executes at a time, so `activeConnectionId` can never be rebound
  by a concurrent in-flight dispatch. This is the exact `serializedChainStep`
  pattern already trusted in the file (app.js 1939-1960): `lock = task.then(() => {}, () => {})`.
- **No deadlock on throw / early return.** The `activeConnectionId` restore is in
  a `finally`, so every inner early `return` (`!state.sessionKey`, ratchet-window
  drop) still restores it. The pre-`try` early return (torn-down connection,
  line 1869) runs before any mutation, so no restore is needed there. The tail
  `state.messageDispatchLock = task.then(() => {}, () => {})` swallows any
  rejection, so a failing dispatch can never wedge the queue for later messages.
- **In-order same-connection delivery preserved.** Multiple messages on one
  connection chain in arrival order and run serially → FIFO, no reordering.
- **1:1 regression-free.** With a single connection, `ownerConnectionIdAtWireTime`
  equals `activeConnectionId`, so the rebind is a same-value no-op; the queue
  just serializes a single stream. Full suite green (670 tests).

### LOW (iter1): inbound group-message accepted without a getGroup existence check — CLOSED

The `group-message` handler (app.js ~1629-1676) now calls
`getGroup(control.groupId)` and `return`s early when it resolves undefined,
gated on `state.identityKeyPair?.vaultKey` — identical scoping to
`group-member-joined`'s own check and consistent with GC1's profile-mode-only
persistence decision (ephemeral mode has no group store, so the check is
correctly skipped there). Anti-spoofing gates (`state.peerFingerprint`
present, `getActivePeer().groupId === control.groupId`) remain intact ahead of it.

## Second pass over the rest of the diff

Re-scanned the delta since iter1; the previously-cleared areas (fan-out send,
anti-spoofing, history JSON round-trip, buildInviteLinkText 1:1 invariant,
activeGroupId UI routing, i18n) are unchanged in shape. No new concerns.

Converged at iteration 2.
