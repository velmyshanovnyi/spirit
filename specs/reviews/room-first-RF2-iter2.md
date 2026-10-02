---
spec: specs/ui/room-first.md
section: RF2 — room controls (mic / camera / leave), owner auto-call
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: FAIL — 1 MEDIUM, 1 LOW (note); both addressed in iter3

## F1 (MEDIUM) — flags not reset on the A3 "new session on top of a live one" path
`client/js/app.js` initiateChatSession: `resetActiveConnection();` followed by `state.peerFingerprint = null;`
`callOfferSent` / `localTracksAddedToPeer` / `ownAnnouncePromise` are global
(not `PEER_PROXY_FIELDS`), only reset in `teardownMediaAndConnection` and
`handleConnectionTornDown` — and the old connection's torn-down handler bails
on its stale-id guard. Scenario: live call in room A → quick-chat / "message
contact" without leave/logout → peer verified → `startCall()` returns on
`callOfferSent`, taps gated too → silently dead call (same class as iter1 F1).
**Fixed (iter3):** the three fields are reset next to `resetActiveConnection()`
in `initiateChatSession`; new test drives a second `btn-initiate` on top of a
live verified call and asserts the offer + `addLocalMediaTracks(pc2)` (RED
proven by removing the reset).

## F2 (LOW) — no connection-id guard across the await in autoStartOwnerCall
`await state.ownAnnouncePromise;` — after the await, `startCall()` reads
whatever connection is active. **Fixed (iter3):** `activeConnectionId`
captured synchronously before the await; return if it changed.

## Checks that passed
Announcer refactor (IIFE closed; early-return keeps `inFlight` null; other
callers ignore the return value; the GC4 per-entry announcer untouched);
owner trigger only on `initiateChatSession` entries (joiner/auto-join use
`ownsInvite:false`, group-tagged invites never set the flag); 20 ms
"no offer before verification" assertion is meaningful (would have caught
iter1); retry test non-vacuous; spec wording matches.

Tests: app.test.js 407/407.
