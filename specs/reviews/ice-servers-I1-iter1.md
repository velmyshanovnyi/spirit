---
spec: specs/phase5/ice-servers.md
section: I1 — client-side ICE server list
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/iceServers.js
  - client/js/webrtc.js
  - client/js/app.js
  - client/js/serverConfigUI.js
  - client/tests/iceServers.test.js
  - client/tests/rtcConfig.test.js
  - client/tests/app.test.js
  - specs/phase5/ice-servers.md
---

# Verdict: PASS — 0 code findings; 2 spec-drift notes + 1 stale comment, all fixed

1. **ICE entries** — Cloudflare's six transports are valid RFC 7065 spellings
   (`?transport=tcp` on `turns:` redundant but matches the vendor list);
   Open Relay urls + static pair match the user's target.
2. **buildIceServers** — dedupe, empty-turnUrl, Cloudflare-only-with-both-fields
   all correct; `OPEN_RELAY_SERVER` frozen and never mutated (the only
   `iceServers.push` is behind `!Array.isArray`).
3. **app.js** — default list is exactly [google, cloudflare, openrelay]; a custom
   STUN appends; `forceTurnRelay` flows; `cloudflareTurnCredential` not reset on
   logout — acceptable (per-node, TTL'd); I3 must refresh/clear on node change.
4. **webrtc.js overload** — array form ignores turn* opts; only caller is
   currentRtcConfig (passes forceTurnRelay only); documented.
5. **serverConfigUI** — preset + saved-node restore write the static pair; no code
   use of the HMAC helper left (turnCredentials.js kept, now un-imported).
   Stale comment about the HMAC TTL → reworded.
6. **Tests** — `DEFAULT_ICE_SERVERS` literally equals `buildIceServers({...})`
   output, so the exact-equality rtcConfig tests are meaningful; replaced
   HMAC-era preset tests keep their intent.
7. **Spec** — F1 `stunUrls` → `stunUrl` (fixed); F2 index.html item not touched
   (reworded before ticking).

Tests: 4 target files 430/430. Author full suite: 69 files, 1100/1100.

## Author's live verification (2026-10-03; 4 files byte-identical on both hosts)
- **kolomedi**: real `RTCPeerConnection` with the deployed `currentRtcConfig`
  list (3 entries) — `host` + `srflx` candidates within seconds; **no `relay`
  candidate from Open Relay in 12 s**.
- **kibr**: Open Relay alone, `iceTransportPolicy: "relay"`, 20 s — **0 candidates**.
  Same pattern as the HMAC endpoint in A12; recorded there. STUN entries work.
  Open Relay stays a best-effort fallback; Cloudflare TURN (I2/I3) is the
  primary relay once keys are provided.
