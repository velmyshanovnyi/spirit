---
spec: phase5/security-hardening
section: P2a
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/ratchet.js
  - client/tests/ratchet.test.js
  - client/js/e2ee.js
  - client/js/identity.js
  - client/js/codec.js
  - specs/phase5/security-hardening.md
---

Zero findings. Crypto core reviewed against 5 scrutiny points:

1. `deriveRootKey` — ECDH(P-256)+HKDF matches the safe `e2ee.js` pattern. Extractable raw-bytes root key is required for downstream HKDF and is an acceptable, spec-sanctioned tradeoff. Domain separation from `e2ee.js` confirmed: distinct HKDF `info` strings (`spirit-ratchet-root-v1` vs `spirit-e2ee-v1`) on the same ECDH shared secret → computationally independent, non-collidable, non-derivable.
2. `deriveInitialChainKeys` — `.sort()` on base64 SPKI wire strings is deterministic and symmetric (all-ASCII alphabet → code-unit order equals byte order; both peers sort the identical pair identically). Traced both sides: A.send===B.receive and vice-versa. `CHAIN_HKDF_INFO || wireBytes` has no prefix-collision ambiguity (single variable field appended to constant prefix, fixed-length P-256 SPKI). Degenerate `localWire===peerWire` case requires both peers sharing a private key — out-of-scope misconfiguration, not a defect.
3. `ratchetStep` — deriving `messageKey` and `nextChainKeyBytes` from the same PRK via distinct `info` strings is the standard symmetric-ratchet construction, no key reuse. Forward secrecy holds (HKDF one-wayness prevents recovering `chainKey` from either output). Correctly omits post-compromise security, as scoped by the spec.
4. Test coverage adequate: symmetry, determinism, chain distinctness, per-step forward secrecy, AES-GCM usability all covered. The one-wayness test is necessarily indirect (unavoidable given non-extractable CryptoKey outputs), not an impl gap.
5. No general correctness issues found.

Convergence: reached on iteration 1, no re-review needed.
