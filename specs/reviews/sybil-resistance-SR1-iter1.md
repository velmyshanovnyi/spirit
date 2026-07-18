---
spec: phase5/sybil-resistance
section: SR1
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/pow.js
  - client/tests/pow.test.js
  - server/library/Pow.php
  - server/verify/section_pow.php
  - specs/phase5/sybil-resistance.md
---

Zero findings requiring code changes. Cross-language crypto core reviewed against 5 scrutiny points:

1. **Leading-zero-bit counting agreement (JS vs PHP), all edge cases** — read both loops character-by-character (`client/js/pow.js`'s `countLeadingZeroBits`, `server/library/Pow.php`'s `countLeadingZeroBits`): structurally identical (outer loop over bytes, `byte===0` fast-path `+=8`, inner MSB-first bit scan). Confirmed correct on: first-bit-already-1 (0 leading zeros, nonce "1"), all-zero digest (256, both fall through to a final `return count` with no silent-zero bug), and the exact byte-boundary case (8 zero bits = one 0x00 byte then a high-bit-set byte, nonce "21", digest `00be...`).
2. **`buildPowChallenge` byte-identical string format** — JS template literal `${timeWindow}:${senderKey}` vs PHP concatenation `$timeWindow . ':' . $senderKey` produce identical decimal ASCII for the spec's guaranteed non-negative-integer `timeWindow`; asserted directly in `server/verify/section_pow.php`.
3. **`solvePow`'s `maxAttempts` default (2^24)** — sound safety margin over the spec's recommended 20-bit production difficulty (~2^20 expected attempts); false-negative probability within the cap ≈ 1.1e-7. Test-only 8-bit difficulty is clearly labeled and kept separate in both `pow.js`'s doc comment and `pow.test.js`.
4. **crypto.subtle.digest vs PHP hash() byte order** — both are standard big-endian SHA-256 raw digest bytes, scanned in buffer order MSB-first on both sides; confirmed explicitly, no endianness divergence possible in this code path.
5. **Test vector correctness** — the reviewer independently recomputed SHA-256 for all 4 shared vectors (`1000:testSenderKey:{1,36,21,11280}`) via Node's `crypto.createHash` (not this codebase's own logic) and confirmed leading-zero-bit counts of exactly 0/4/8/12, matching what both `client/tests/pow.test.js` and `server/verify/section_pow.php` assert.

Non-blocking observation (no action needed for SR1): `buildPowChallenge` assumes `timeWindow` is always a non-negative integer (guaranteed by the spec's `floor()` division); a future SR2 caller must uphold that contract, already documented in `pow.js`'s doc comment.

Convergence: reached on iteration 1, no re-review needed.
