---
spec: (no formal spec file -- feature-sized change, ~5 files; small-change
  carve-out philosophy applied given the established precedent this session
  for comparably-sized additions like the "Дизайн" menu shortcut)
section: free public TURN preset (Open Relay Project, shared-secret scheme)
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/turnCredentials.js
  - client/tests/turnCredentials.test.js
  - client/js/app.js
  - client/index.html
  - client/tests/app.test.js
  - client/js/i18n.js
---

## Context

User request (2026-08-08): add openrelay.metered.ca as a free, no-signup
public TURN preset (analogous to the existing STUN preset dropdown, Section
C8), or find real alternatives.

Researched live via WebFetch/WebSearch BEFORE writing any code: the
widely copy-pasted static `username: openrelayproject / credential:
openrelayproject` pair from countless WebRTC tutorials is stale -- the
official Open Relay Project page no longer documents it and now requires
signup + an API key. The one mechanism still documented without signup is
`staticauth.openrelay.metered.ca`'s shared-secret scheme, the standard
coturn "TURN REST API" / `use-auth-secret` convention (same one Nextcloud
Talk and Jitsi deployments use): a client-computed, TIME-LIMITED credential
(`username = "<expiry>:<label>"`, `credential = base64(HMAC-SHA1(secret,
username))`), not a fixed login/password pair.

## Verdict: CONVERGED (after fixes below)

Reviewer independently re-verified the HMAC construction against Node's
`crypto.createHmac` across 5 cases beyond the test's own vectors (UTF-8
secret, Cyrillic label, a >64-byte key past SHA-1's block boundary) and
against RFC 2202 test case 2 -- all matched. Mutation-tested three real
mutants (HMAC key/message swap, SHA-1→SHA-256, dropped `await` in `app.js`)
-- all three killed by the test suite. No STUN-preset regression.

## Findings and resolutions

1. **CONFIRMED, documentation**: `turnCredentials.js`'s module comment
   claimed the credential "must be (re)computed close to connection time...
   see `currentRtcConfig()` in `app.js`, which calls this fresh on every
   connection attempt" -- but `currentRtcConfig()` was never touched; it
   reads the static form-field values, same as the STUN preset, exactly the
   behavior the comment denied. **Fixed**: reworded to describe what
   actually ships (recomputed on preset selection and on selecting a
   preset-backed saved node, not on every connection attempt), and named
   the residual staleness window honestly (a tab left open past the TTL
   without reselecting).
2. **CONFIRMED, real bug, more severe than finding 1**: "Save signaling
   node" persisted the HMAC credential verbatim into `localStorage`
   (`spirit.signalingNodes`), and selecting that saved node later restored
   it verbatim, with no expiry awareness. Concrete failure the reviewer
   traced: save the free-relay preset as a node → return after the 24h TTL
   → select the saved node → fields look populated correctly → TURN server
   rejects the expired HMAC → every ICE candidate fails, surfacing only as
   a generic ICE-gathering timeout -- indistinguishable from "the relay is
   down", precisely the ambiguity this file's own header comment cites as
   the reason the OLD static credential pair was rejected in the first
   place. **Fixed**: saved nodes now record `turnPreset` (which preset was
   active, not the credential); selecting a preset-backed saved node
   regenerates a fresh credential via `computeTurnRestCredential` instead
   of restoring the stored one. A node with no `turnPreset` (older saves,
   or "custom") falls through to the original verbatim-restore behavior
   unchanged. Three new tests: preset recorded on save, fresh regeneration
   on restore (a deliberately long-expired stored value must not survive),
   and custom nodes restoring verbatim as before.

## Assessed, not findings (reviewer's independent judgment)

- **Username format ("<expiry>:<label>")**: matches the canonical coturn
  `use-auth-secret` convention and every reference deployment the reviewer
  could find. Explicitly flagged as **unverified against the real vendor
  server** -- neither the reviewer nor this session had a live two-peer
  WebRTC rig to test against `staticauth.openrelay.metered.ca` itself. This
  is the single largest open risk in the change and is exactly why live
  verification (below) matters more than usual here.
- **Shared secret hardcoded in client code**: intentional and acceptable --
  it's the vendor's own published value for exactly this embedding pattern
  (their own cited example: Nextcloud Talk), consumes the vendor's shared
  community pool rather than any Spirit-specific allocation, and the code
  already documents this reasoning.
- **UI placement and hint tone**: fine as shipped -- preset → the three
  fields it fills → the `force-turn-relay` checkbox and its own hint, which
  now reads true (it requires real credentials in those three fields, and
  the preset is one way to get them).

## Suite

`turnCredentials.test.js` 6/6 · `app.test.js` -t "TURN preset\|signaling
UI" — all new tests pass · full suite **1013/1013** (the one failure in
the first run was the pre-existing, unrelated `ICE gathering timeout`
flake -- backlog A10 -- confirmed passing in isolation).

## Outstanding, not addressed here

The reviewer's residual-uncertainty point stands: this has NOT been
verified against a real two-peer WebRTC connection through the actual
`staticauth.openrelay.metered.ca` server. Live verification after deploy
should specifically attempt a real forced-TURN-relay connection using this
preset on both hosts, not just confirm the UI fills the fields correctly.

## Post-deploy live verification (2026-08-08): INCONCLUSIVE, filed as backlog A12

Attempted exactly the check called out above. Results:

- UI wiring confirmed correct on a verified-fresh deploy (compared
  cache-honouring vs. `cache:"no-store"` fetches first, per backlog A11's
  lesson): selecting the preset fills all three TURN fields with a live
  HMAC credential.
- Control checks in the same harness work: STUN to `stun.l.google.com`
  gathers real candidates in seconds; Metered's OTHER endpoint
  (`global.relay.metered.ca`) returns a real protocol-level TURN Allocate
  error (400, expected -- it needs their per-account API-key credential
  scheme, not this one), proving the network path to the vendor's
  infrastructure is open in this environment.
- `staticauth.openrelay.metered.ca` itself never responded at all --
  tried UDP and TCP on ports 80/443, `turns:` (TLS), and a direct
  connection to its DNS-resolved IP bypassing hostname lookup entirely
  (`216.39.253.123`, confirmed live via an independent DNS-over-HTTPS
  query to 1.1.1.1). No ICE candidates, no `icecandidateerror` events,
  across waits up to 20s per variant.

This does not prove the endpoint is dead -- it could be this session's
browser sandbox silently dropping traffic to that one host specifically,
and public search found no recent reports of an outage. But it is a real,
reproducible negative result against the one thing this whole feature
depends on, so it is not honest to call this section fully verified.
Recorded as **docs/backlog.md A12** for a check from a real (non-sandboxed)
browser with two live peers before relying on this preset.
