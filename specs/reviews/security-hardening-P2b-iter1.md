---
spec: phase5/security-hardening
section: P2b
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/js/ratchet.js
  - client/js/webrtc.js
  - client/js/e2ee.js
  - client/js/codec.js
  - client/tests/app.test.js
  - specs/phase5/security-hardening.md
---

Two findings, both requiring fixes before commit (per dismissibility rule, neither dismissible without caller evidence that the path cannot occur):

**1. CONFIRMED — Non-atomic ratchet chain advance desyncs under concurrent messages** (`client/js/app.js`, `nextReceiveMessageKey`/`nextSendMessageKey` helpers, `onMessage` callback, `btn-send` handler). `ratchetStep` is a stateful, sequential step over shared mutable `state.sendChainKey`/`state.receiveChainKey`. Because `onMessage` is an async per-event handler and `crypto.subtle` yields, two back-to-back incoming chat messages can interleave: both read the same chain key, both derive the same message key, the chain advances only once. The second message then fails to decrypt permanently, desyncing the session irrecoverably. This is NOT the spec's scoped-out network-out-of-order case (P2a explicitly disclaims that) — it happens on a reliable+ordered DataChannel purely from local handler interleaving, so the existing disclaimer does not cover it. Same pattern applies to `btn-send` (no re-entrancy guard against a double-click).

**2. PLAUSIBLE (low) — `sessionKey` guard doesn't cover the chains** (`client/js/app.js`, `onMessage`'s `if (!state.sessionKey) return;` guard). `state.sessionKey` is set one `await` before the chains are derived (via `deriveRootKey`/`deriveInitialChainKeys`). The guard can pass while `receiveChainKey` is still null; an R1 message arriving in that narrow window would throw inside `ratchetStep(null)`, silently swallowed by the outer catch, and lost. Low likelihood, self-limiting (chain not advanced so no permanent desync), but `sessionKey` alone is not a correct readiness gate for the chains.

Non-defects confirmed during this pass (not re-raised in future iterations without new evidence):
- Prefix collision: impossible. `RATCHET_WIRE_PREFIX = "R1:"` contains a colon, outside the base64 alphabet (`A–Za–z0–9+/=`) that `encryptMessage`'s `btoa`-based output uses — a static-sessionKey ciphertext can never start with `"R1:"`.
- Ordering/reliability: WebRTC DataChannel is created with no options (`pc.createDataChannel(DATA_CHANNEL_LABEL)`), i.e. default reliable+ordered delivery. Network-level out-of-order desync is not a live risk and is explicitly scoped out by spec P2a — an acknowledged, adequately-documented limitation, distinct from finding #1 (a local concurrency race the ordered channel does not prevent).
- Wire values passed into `deriveInitialChainKeys` at both `startInitiatorSession`/`startJoinerSession` call sites are correct and consistent (local wire first, peer wire second on both sides; `deriveInitialChainKeys` internally sorts to agree on send/receive assignment).

Convergence: not reached, iteration 2 required after fixes.
