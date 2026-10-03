---
spec: specs/phase5/ice-servers.md
section: I2 — get_ice_servers endpoint (PHP, Cloudflare TURN credentials)
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - server/library/TurnCredentialProvider.php
  - server/library/SignalingController.php
  - server/config.php
  - server/public/index.php
  - server/verify/section_turn_credentials.php
  - server/verify/section_signaling_controller.php
  - specs/phase5/ice-servers.md
---

# Verdict: PASS — 2 LOW findings, both fixed

1. **LOW** — fresh-generate path returned `{iceServers, expiresAt, issuedAt}`
   while the cache-hit path returned `{iceServers, expiresAt}`. **Fixed:**
   the public shape is now identical; harness asserts `array_keys === ['iceServers','expiresAt']`.
2. **LOW** — spec said GET; the controller (like every action) accepts POST
   only. **Fixed** in the spec (POST + sender_key).

## Checks (PASS)
- Secret handling: the API token appears only in the Authorization header;
  never in responses, logs, errors or the cache. Cache (server/data, denied
  by .htaccess like database.json/pow_spent.json) holds only the generated
  client-facing pair + timestamps. Shared-hosting residual: at worst 24 h of
  relay quota — accepted.
- Vendor call: endpoint/Bearer/`{"ttl":N}` match Cloudflare Realtime TURN;
  SSL verify on, no redirects, 10 s timeouts, 2xx check, fixed host (no SSRF).
- Cache: intdiv half-life with `<` (regenerates exactly at 43200 s, harness
  covers); stale-but-unexpired served on vendor failure; expired+failure → empty;
  lock-free tmp+rename, last writer wins, bounded by the per-IP limiter.
- Normalisation: only string username/credential + `turns?:` urls pass;
  single-object responses wrapped; empty → failure.
- Placement: after sender_key/whitelist/per-IP limiter, before room-creation
  limiter and the database lock; `{status, body}` shape consistent.
- PHP ≥ 8.1 required (`array_is_list`); both live hosts answer 200.

Harnesses: section_turn_credentials 10/10, section_signaling_controller all_passed.

## Author's live verification (2026-10-03)
Both hosts, `POST spirit/public/index.php {"action":"get_ice_servers","sender_key":…}`
→ `200 {"iceServers":[],"expiresAt":null}` (keys not yet set — degraded mode
as designed). Vendor path exercised only via the injected-transport harness
until the user provides the Cloudflare Key ID / API Token.
