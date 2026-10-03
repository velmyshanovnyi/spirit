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

## Author's live verification with the real Cloudflare keys (2026-10-03, later the same day)
Keys for the Cloudflare Realtime TURN app "spirit" written to
`spirit/config.secrets.php` on both hosts (FTP, outside git).
- Direct vendor call: HTTP 201 (the provider accepts any 2xx), response has
  TWO entries -- a credential-less `stun:` entry and the TURN entry; the
  normaliser keeps only the TURN one (as the harness's mixed case predicted).
- `get_ice_servers` on kolomedi and kibr: 1 entry, 6 transports, 64-char
  username/credential, `expiresAt` = now + 24 h.
- Fresh tab on each host: the client fetched and stored the pair
  (`spirit.iceCredential`, expires in 24 h); relay-only `RTCPeerConnection`
  with that pair → **8 (kolomedi) / 9 (kibr) `relay` candidates from
  turn.cloudflare.com**, mostly relayProtocol tcp (the pane blocks UDP) --
  i.e. the primary relay works even on a UDP-restricted network.
- Reload on kibr: the stored pair survived, `currentRtcConfig`'s list has 4
  entries with Cloudflare at index 2 (behind the two STUNs, ahead of Open
  Relay), and a new room sent NO re-fetch (before half-TTL) -- the half-TTL
  rule holds end-to-end. No console errors.

