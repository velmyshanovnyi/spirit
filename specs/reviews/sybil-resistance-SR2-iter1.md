---
spec: phase5/sybil-resistance
section: SR2
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - server/library/PowNonceStore.php
  - server/library/Pow.php
  - server/library/SignalingController.php
  - server/config.php
  - server/public/index.php
  - server/verify/section_pow_integration.php
  - client/js/signalingClient.js
  - client/js/app.js
  - client/js/i18n.js
  - client/js/pow.js (SR1, read for cross-reference)
  - client/tests/signalingClient.test.js
  - client/tests/app.test.js
---

Positively verified (no changes needed): challenge construction byte-identical
across JS (`buildPowChallenge`) and PHP (`Pow::buildChallenge`); anti-replay
(`PowNonceStore::checkAndMarkSpent`) runs BEFORE `withLock`/`dispatchAction`
(room creation), never after; `PowNonceStore`'s atomic tmp-then-rename +
`LOCK_EX` write pattern and best-effort-caveat framing mirror
`RateLimiter.php` exactly; the general per-IP rate limiter
(`RateLimiter::checkAndRecordRequest`) and the room-creation rate limiter both
still run, unchanged, before the new PoW gate; 400-vs-429 distinction is
correct (PoW failures are 400, never counted as a rate-limit rejection); the
client does not retry-loop on a PoW rejection; all 11 i18n locales received
`status.solvingPow` with correct encoding; the verify harness's
`intdiv($now, $windowSeconds)` matches the controller's own
`(int) floor($powTimestamp / $windowSeconds)` for the positive timestamps in
scope; `PowNonceStore::spentKey`'s SHA-256-over-NUL-delimited-triple hashing
is collision-safe.

## Blocking finding (fixed this iteration)

**Deterministic `solvePow` + per-identity anti-replay broke legitimate repeat
`create_invite` within the same 30s window.**

`solvePow` (SR1, `client/js/pow.js`) always brute-forced nonces starting at
`0`, so it was fully deterministic for a given `(challenge, difficultyBits)`.
`initiateChatSession` (`client/js/app.js`) uses the stable identity
`state.senderKey`, so the challenge `${timeWindow}:${senderKey}` -- and
therefore the solved nonce -- was identical across two `create_invite` calls
from the same identity within the same 30-second PoW window (e.g. messaging
two different contacts in quick succession, or retrying quick-chat). The
server's anti-replay, keyed on `(timeWindow, senderKey, nonce)`
(`SignalingController::checkPow` -> `PowNonceStore::checkAndMarkSpent`),
rejected the second call as a "replay" even though it was a completely
legitimate, independent request -- a real, user-visible break of an ordinary
flow, not an edge case.

Root cause: a spec/impl gap between the spec's "nonce (випадковий
рядок/число)" (random string/number) framing and SR1's deterministic-from-0
`solvePow` implementation, surfaced only once SR2 wired it into a flow where
the same identity legitimately creates multiple invites per window (SR1's own
tests never exercised two solves of the same challenge from one caller).

**Fix**: `client/js/pow.js`'s `solvePow` now defaults to a randomized search
start (`randomStartAttempt()`, via `crypto.getRandomValues`) instead of
always starting at nonce `"0"`. Two solves of the identical challenge now
produce different nonces with overwhelming probability (a few hundred to a
few thousand sequential attempts drawn from a `2^32` random offset space),
while each nonce still independently satisfies `verifyPow` -- server-side
verification (`Pow::verify`) is completely unaffected, since it only checks
the digest of whatever nonce string it's given, never assumes a nonce range.
An explicit `startAttempt` option was added for deterministic testing
(`client/tests/pow.test.js`'s new regression-control test asserts two calls
with `startAttempt: 0` produce the identical nonce). New coverage:
`client/tests/pow.test.js` asserts two `solvePow` calls against the identical
challenge produce different, independently-valid nonces.

Full JS suite re-run after the fix: 601/601 passing (up from 599/599 pre-fix
-- 2 new tests in `pow.test.js` for this fix).

## Non-blocking (noted, no action taken)

1. Awaited-per-attempt `crypto.subtle.digest` in `solvePow`'s loop may be
   slower than "~1s" on weak mobile hardware at 20-bit difficulty --
   pre-existing SR1 characteristic, not introduced by SR2; the `status.solvingPow`
   UI message (this section) already exists specifically to surface that wait
   to the user rather than looking hung.
2. A failed-PoW `create_invite` still consumes the requester's own per-IP
   room-creation rate-limit slot (checked before the PoW gate). Self-limiting
   (only burns the requester's own quota, never a third party's), consistent
   with the spec's "records regardless of outcome" framing for the general
   bucket -- not treated as a defect.

## Convergence

Iteration 1 found 1 blocking issue; fixed and covered by a new regression
test in the same commit. Re-review requested for iteration 2 to confirm the
fix and check for any new issues introduced by it.
