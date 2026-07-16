---
spec: phase5/security-hardening
section: P2b
iter: 2
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
---

Converged. Zero new findings.

Both iteration-1 findings confirmed fixed:

1. **Non-atomic chain advance**: `serializedChainStep(lockField, chainField)` (`client/js/app.js`, defined alongside `nextSendMessageKey`/`nextReceiveMessageKey`) chains each call onto `state.sendChainLock`/`state.receiveChainLock` and reassigns the lock field synchronously (no `await` between reading and writing it), so two calls issued in the same tick without intervening awaits are still queued in the correct order rather than reading the same chain key. Verified against the new test "serializes concurrent incoming R1 messages so the receive chain never desyncs" (`client/tests/app.test.js`), which fires two `onMessage` calls unawaited and asserts the second `ratchetStep` call's input equals the first's output — this exercises the actual race, since the mock `ratchetStep` awaits a real microtask matching `crypto.subtle` timing.
2. **`sessionKey` guard not covering chain readiness**: the `isRatcheted && !state.receiveChainKey` guard closes the window between `sessionKey` and chain-key assignment. Verified against the new test "drops an R1 message that arrives in the window where sessionKey is set but the receive chain isn't yet", which forces `deriveRootKey` to reject so `sessionKey` is set but chains aren't, then confirms the R1 payload never reaches `decryptMessage`.

Full suite verified: `client/tests/app.test.js` 142/142 passing; project-wide 425/425 (excluding one pre-existing, unrelated codec.test.js timeout).

Convergence reached at iteration 2 — no re-review needed.
