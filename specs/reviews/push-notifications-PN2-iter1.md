---
spec: phase5/push-notifications
section: PN2
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/vapidKeys.js
  - client/js/vapid.js
  - client/tests/vapid.test.js
---

Zero findings. Converged on iteration 1.

Verification performed via actual execution (Node webcrypto), not just reading:

1. **Keypair internal consistency (highest-value check)**: `VAPID_PUBLIC_KEY_RAW_BASE64URL` decodes to exactly 65 bytes, `raw[0]==0x04`, `raw[1..33]` byte-for-byte equals the JWK `x`, `raw[33..65]` equals the JWK `y`. The private `d` genuinely corresponds to that public point (a signature made with the private JWK verifies against the public JWK). No silent subscribe-vs-sign mismatch -- this is exactly the kind of self-consistent-but-wrong bug a unit test of vapid.js alone couldn't catch, and it was confirmed correct.
2. **ECDSA signature format**: `crypto.subtle.sign` for P-256 returns exactly 64 bytes (raw IEEE P1363 r||s), precisely what JOSE ES256 (RFC 7518 §3.4) requires. No DER-to-raw conversion needed or present; the inline comment accurately documents this well-known interop gotcha.
3. **`ttlSeconds` capping**: `Math.min(ttlSeconds, MAX_TTL_SECONDS)` correctly caps large values. Negative/zero edge cases produce an `exp` at/before `now`, which is a non-issue (fail-closed via provider rejection, no untrusted external caller, function only ever called internally with the sane default).

Non-blocking observations (not defects):
- Reusing `bytesToBase64Url` from webPushCrypto.js (PN1) rather than duplicating it: no circular dependency, clean stateless coupling, vapid.js remains independently testable. Mildly inconsistent with one other file's local-helper precedent (deterministicIdentity.js), but defensible as sharing a single canonical encoder between sibling PN modules.
- No test for JSON-escaping of `aud`/`subject` containing quotes/backslashes: genuine non-issue, `JSON.stringify` handles it correctly by construction and these are always well-formed URIs in practice.

Full suite verified: 475/475 project-wide (vapid.test.js: 5/5).
