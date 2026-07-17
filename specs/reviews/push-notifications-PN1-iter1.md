---
spec: phase5/push-notifications
section: PN1
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/webPushCrypto.js
  - client/tests/webPushCrypto.test.js
---

Zero findings. Converged on iteration 1.

Traced the RFC 8291 §3.3/3.4 + RFC 8188 §2.1 implementation from memory against 8 scrutiny points, focused specifically on interoperability risk (a bug that's wrong in a self-consistent way could still pass this module's own round-trip tests against its matching decrypt function while producing payloads a real browser's native Web Push decoder cannot read):

1. `key_info = "WebPush: info" || 0x00 || receiver_pub || sender_pub` -- correct order, correct finalized-RFC literal string (not the older draft's `Content-Encoding: auth`). `auth_secret` correctly used as HKDF-Extract salt, ECDH shared secret as IKM.
2. CEK/nonce derivation strings (`Content-Encoding: aes128gcm` / `Content-Encoding: nonce`, both null-terminated) correct, stage-2 keyed by the per-message random salt with stage-1 IKM as input.
3. Header layout (`salt(16) || recordSize(4, big-endian) || idLen(1) || keyId(idLen)`) correct; `DataView.setUint32(..., false)` is big-endian; 4096 is a valid record size.
4. Padding delimiter (`0x02`, single-record only, never `0x01`) correct; empty-plaintext edge case in the strip-trailing-zeros-then-check-0x02 decode loop traces cleanly to an empty string with no off-by-one.
5. AES-GCM authentication tag correctly included in the ciphertext slice on decrypt (no truncation).
6. Fresh ephemeral ECDH keypair AND fresh random salt generated on every `encryptWebPushPayload` call, both independently feeding the nonce derivation -- defense-in-depth against AES-GCM nonce reuse holds even if one were somehow to be reused.
7. `base64UrlToBytes`/`bytesToBase64Url` correctly handle standard base64url alphabet and unpadded-input padding restoration for both possible remainder cases (auth: 16 bytes -> mod-4=2; p256dh: 65 bytes -> mod-4=3).
8. No general correctness bugs. Test coverage (7 tests, including two negative/tamper-detection tests) is appropriate for a pure crypto core.

**Residual risk noted (not a defect, a follow-up item)**: round-trip + negative tests prove internal consistency and the implementation reads as byte-for-byte spec-correct, but full interoperability with a REAL browser's native Web Push decoder can only be proven via an external cross-check (e.g. against the Node `web-push` package, or an actual push to a real `PushSubscription`). Recorded as a required step before PN5 (actual push sending) is considered done, not before this section's own convergence.

Full suite verified: 470/470 project-wide (webPushCrypto.test.js: 7/7).
