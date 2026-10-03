---
spec: specs/phase5/ice-servers.md
section: I3 — client fetches/refreshes the Cloudflare TURN credential
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/js/signalingClient.js
  - client/tests/app.test.js
  - client/tests/signalingClient.test.js
  - specs/phase5/ice-servers.md
---

# Verdict: PASS — 0 new findings (delta of the two iter1 fixes)

- (a) No TDZ: the only synchronous use in initApp is the startup
  `applyIceCredential(loadStoredIceCredential())` after the block's const/let;
  every `currentRtcConfig()` call is inside async/event code.
- (b) Repeated calls bounded by the three early returns + in-flight guard; a
  permanently degraded node costs one fire-and-forget POST per connection.
- (c) Abort → SignalingError → caught; guard cleared in `finally` (even a
  ReferenceError on `AbortSignal` is inside the try).
- (d) Browsers without `AbortSignal.timeout` just get no timeout.
- (e) Tests meaningful (would have failed on iter1 code).
- (f) Spec wording matches.

Tests: "Section I3" 10/10. Author full suite: 69 files, 1109/1109.

## Author's live verification (2026-10-03; app.js 146624 B, signalingClient.js 6663 B byte-identical on both hosts)
Fetch wrapper on both hosts: entering a new room (`btn-room-leave` →
initiateChatSession → currentRtcConfig) sends `get_ice_servers` WITH an
AbortSignal, then `create_invite`; the nodes answer the degraded empty shape
(no Cloudflare keys yet), so nothing is stored in `spirit.iceCredential` and
connections keep the 3-entry static list. No console errors. The full
Cloudflare path (relay candidates from turn.cloudflare.com) is pending the
user's Key ID / API Token in config.secrets.php on both hosts.
