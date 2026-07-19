---
spec: phase4/group-chats
section: GC0
iter: 2
agent: opus-subagent (general-purpose), independent from iter1
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - specs/phase4/group-chats.md
  - specs/reviews/group-chats-GC0-iter1.md (context only, not deferred to)
---

Focus: 1:1-behavior regression hunt, deliberately differently framed from iter1 (which
reviewed refactor mechanics). Traced the full lifecycle of a normal 1:1 chat session
end-to-end against the refactored code: initiator flow, joiner flow, identity announce,
message send/receive + ratchet chain advancement, logout/reset, device-linking reuse of
the session helpers, and video-call renegotiation on the same peer connection.

## Result

Six of seven traced areas PASS as byte-identical to the original flat-state code:
initiator flow, joiner flow, identity announce (re-reads state fresh every invocation,
captures nothing eagerly), device-linking reuse, and video-call renegotiation.

One finding (F1, LOW severity, fixed before this iteration closed):

**`client/js/app.js`, `serializedChainStep` (ratchet chain advancement) and
`onChannelOpen`**: `ratchetStep(...)` awaits real `crypto.subtle` work, yielding the
event loop. If `btn-logout`'s `resetActiveConnection()` ran during that await, the
pending writeback (`state.receiveChainKey = nextChainKeyBytes` / `state.channel =
channel`) would hit the `PEER_PROXY_FIELDS` setter's `ensureActivePeer()`, which -- finding
no active entry -- would lazily **resurrect a brand-new phantom `state.peers` entry
after logout**, leaving `state.activeConnectionId` non-null and violating the
"everything reads back null/false after logout" invariant that held under the original
flat-state code (where a late write there just landed on an inert dead field with no
side effect on any other state).

Reachable, not hypothetical: normal chat message arrives -> `onMessage` ->
`nextReceiveMessageKey()` -> `serializedChainStep` schedules the async step; user clicks
logout during that await window; the deferred writeback then executes post-teardown.
Same pattern applies to a data channel finishing its open handshake right after logout.

Severity assessed LOW (tight async race, self-healing on next session start, doesn't
break the 1:1 happy path) but a real, fixable divergence -- fixed rather than dismissed,
per this project's dismissibility rule (no caller evidence that the race is unreachable;
in fact it's straightforwardly reachable).

## Fix applied

- `serializedChainStep` (client/js/app.js) now snapshots `state.activeConnectionId`
  before the `await ratchetStep(...)` and only writes `state[chainField]` back if the
  active connection is still the same one -- otherwise the stale write is dropped instead
  of resurrecting a new entry.
- `wireChannelCallbacks`'s `onChannelOpen` now snapshots the owning connectionId at
  wire-time and skips `state.channel = channel` if a torn-down/superseded session's
  channel finishes opening late.

Full suite re-run after the fix: 642/642 green (640 pre-existing + the 2 new GC0 tests
from iter1), including the two new multi-connection tests, confirming the fix does not
alter any observable 1:1 behavior.

## Verdict

CONVERGED after one fix. No further findings; no third iteration required.
