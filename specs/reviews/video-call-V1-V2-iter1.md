---
spec: video-call
section: V1+V2
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/webrtc.js
  - client/js/app.js
  - client/index.html
  - client/css/style.css
  - client/tests/webrtc.test.js
  - client/tests/app.test.js
---

## Findings and dispositions

1. **[Medium, FIXED]** Incoming `webrtc-call-offer` was auto-answered (live camera/mic) for a peer whose identity had not yet been verified via `identity-announce`, unlike the existing `peerFingerprint` gate on plain chat text. Fixed: `client/js/app.js` — the `webrtc-call-offer` branch of `handleChatMessage` now returns early with `status.incomingRejected` if `state.peerFingerprint` is unset, mirroring the chat-text gate. Covered by new test "does not auto-answer a call offer from a peer whose identity hasn't been verified yet" (`client/tests/app.test.js`); the existing "auto-answers an incoming call offer" test was updated to go through identity verification first via a new `establishedVerifiedInitiatorChat()` helper.

2. **[Medium, DISMISSED]** Glare (both peers renegotiating simultaneously) can throw `InvalidStateError` inside `createRenegotiationAnswer`, caught into a status message with no rollback/retry. Dismissed: `specs/ui/video-call.md`'s auto-accept decision is explicitly scoped to MVP ("без екрана «вхідний дзвінок»... це майбутнє UX-покращення, не в цьому обсязі"); the failure mode is already safe (caught error → status message, not a crash or hang), and glare-handling was never in the section's Tests/Impl scope. No fix applied.

3. **[Low, FIXED]** Call/camera/mic buttons stayed enabled after the data channel closed, and the local camera/mic stream was left running. Fixed: `client/js/app.js` — `onChannelClose` now disables the three buttons and stops+clears `state.localStream`. Covered by new test "disables the call controls and stops local tracks when the channel closes".

4. **[Low, DISMISSED]** Claim that the "WITHOUT waiting for ICE gathering" test in `webrtc.test.js` is tautological. Dismissed: the fake `RTCPeerConnection` never calls `pc.onicecandidate`, so if `createRenegotiationOffer` were implemented to await ICE gathering (as `startAsInitiator`/`startAsJoiner` do), `await createRenegotiationOffer(pc)` would hang and the test would fail via Vitest's test timeout — a real, reachable signal, not a no-op assertion. No fix applied.

## Verification

Full suite green after fixes: 306/306 (`npx vitest run`), including the new gate/close-lifecycle tests added during this review's fix pass.
