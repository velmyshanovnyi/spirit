---
spec: phase4/group-chats
section: GC2
iter: 1
agent: opus-subagent (general-purpose, model override)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/app.test.js
  - specs/phase4/group-chats.md
---

Focus: trust boundary of the new `group-member-joined` control message (a peer telling this
device about a THIRD party's identity), correctness of the `state.peers` broadcast fan-out, and
whether the new `startTaggedGroupInvite` invite-orchestration helper interacts safely with the
still-fresh GC0 multi-connection state.

## Findings

1. **Trust boundary (spoofing gate) — no finding.** `handleChatMessage`'s `group-member-joined`
   branch (`client/js/app.js`) gates on `state.peerFingerprint` being verified (same level as
   every other `*-announce`), AND additionally checks `getActivePeer().groupId ===
   control.groupId` before accepting -- a peer cannot inject membership for a group its own
   connection was never tagged with. `getGroup(control.groupId)` returning `undefined` (a group
   this device isn't tracking) is silently ignored before `updateGroupMembers` is ever called,
   so `updateGroupMembers`'s own orphan-throw is never reachable from this path.

2. **Broadcast fan-out (`broadcastGroupMemberJoined`) — no finding.** Skips the just-joined
   connection, filters on matching `groupId`, skips entries without a live `channel`/`sessionKey`
   (half-open/half-torn-down), and wraps each send in its own `try/catch` so one peer's failure
   doesn't block notifying the rest. Zero eligible peers is a no-op, not an error.

3. **REAL BUG (fixed in this iteration): concurrent-handshake session corruption.**
   `startTaggedGroupInvite`, called once per selected group member in a loop, started multiple
   CONCURRENT `startInitiatorSession` handshakes. Because handshake-completion writes
   (`state.pc`, `state.sessionKey`, chain keys) always target "whichever `state.peers` entry is
   currently active" rather than the specific entry that handshake belongs to, two overlapping
   pending handshakes could complete out of order and corrupt/misattribute each other's session
   state.
   **Fix**: `startTaggedGroupInvite` now takes a `startLiveSession` flag (default `true`). The
   `btn-create-group` handler passes `startLiveSession: i === 0` -- only the FIRST selected
   contact gets a real, live, listening WebRTC session; every other selected contact's invite is
   minted via `createInvite()` alone (no session, no `state.peers` entry), to be connected to
   individually later. The "add member to an existing group" flow was never affected (always a
   single invite per action). New test asserts `state.peers.size === 1` and
   `startAsInitiator` called exactly once after creating a group with 2 members.

4. **Functional gap (accepted, documented, deferred to GC3): joiner-side groupId tagging.**
   The invitee/joiner side of a group invite never tags its own `state.peers` entry with the
   groupId, so on a real joiner device the `group-member-joined` spoofing gate (Finding 1)
   correctly rejects broadcasts meant for it too -- the notification feature is currently only
   exercised by tests that manually tag the entry to simulate an already-informed member, not by
   a real end-to-end joiner flow. Propagating full group awareness (name, member list) to a fresh
   joinee requires a new control message the joiner can consume on first connect -- explicitly
   GC3 territory per the spec's own section split (GC3 owns the group's routing/UI/awareness
   layer). Judged a reasonable, disclosed scope boundary for GC2, not a silent gap: it does not
   corrupt state or mislead, and GC2's own scope note already rules out "connect everyone
   simultaneously" as in-scope.

5. **Residual, pre-existing, non-blocking**: the "at most one pending initiator handshake at a
   time" invariant that Finding 3's fix relies on is process-wide, not scoped to one UI action --
   firing a second unrelated invite (e.g. a plain 1:1 "message a contact") while a group-create
   handshake is still awaiting `pollForAnswer` reintroduces the same class of race. This is a
   property of the whole GC0 active-connection model that predates GC2, not a defect introduced
   here, and is out of scope for this section (a full per-connection routing layer is GC3-scale
   work per the spec).

## Iteration 2 (confirmation pass)

Re-reviewed the fix in isolation: `startLiveSession: false` takes an early return before touching
`generateEcdhKeyPair`, `state.peers`, `state.activeConnectionId`, or `startInitiatorSession` --
the race condition genuinely cannot arise from the create-group code path anymore. Verified
against the updated test suite (8/8 GC2 tests green, including the new `state.peers.size === 1`
/ `startAsInitiator` call-count assertions, which would fail against the pre-fix loop).

**Outcome**: CONVERGED after 1 fix cycle (Finding 3 fixed; Finding 4 accepted as documented scope
boundary; Findings 1, 2, 5 no action needed).

Full suite: 661/661 passing (653 pre-existing + 8 new GC2 tests in
`client/tests/app.test.js`'s `describe("GC2: group invite orchestration ...")` block).
