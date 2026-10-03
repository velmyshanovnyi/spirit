---
spec: specs/phase5/ice-servers.md
section: I3 — client fetches/refreshes the Cloudflare TURN credential
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/js/signalingClient.js
  - client/tests/app.test.js
  - client/tests/signalingClient.test.js
  - specs/phase5/ice-servers.md
---

# Verdict: FAIL — 1 Major, 1 Minor; both fixed in iter2

## F1 (Major) — trigger coverage gap
Refresh was triggered only in `enterConversationLobby` + quick-chat, while
the spec said `currentRtcConfig()`. Group live invites (deliberately no
lobby), device linking and group mesh build their config via the injected
`currentRtcConfig` and would NEVER refresh → a saved-profile user using only
those paths runs on STUN + Open Relay forever once a stored pair expires.
**Fixed:** `ensureIceCredential()` is the first statement of
`currentRtcConfig()`; ad-hoc triggers removed; test: device linking (no
lobby) triggers the fetch.

## F2 (Minor) — no fetch timeout
A hung node request pinned `iceCredentialRefreshInFlight` for the tab's
lifetime. **Fixed:** `getIceServers(url, {senderKey}, {signal})` with
`AbortSignal.timeout(15000)`; tests for the signal on both layers.

## Checks that passed
Half-TTL math in consistent seconds; clock skew either delays the refresh
(harmless) or drops the pair (self-limiting re-fetch); node switch harmless
(pairs are bound to Cloudflare's key, not the node); only the client-facing
pair + timestamps stored; tests non-vacuous.

Tests: signalingClient + app 439/439.
