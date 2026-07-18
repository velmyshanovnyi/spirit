---
spec: phase5/social-recovery
section: S2
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/trustedShares.js
  - client/tests/trustedShares.test.js
  - client/js/recoveryShare.js
  - client/tests/recoveryShare.test.js
  - client/js/app.js
  - client/tests/app.test.js
  - client/js/db.js
  - client/index.html
  - client/js/i18n.js
---

## Must-fix (1 finding, fixed this iteration)

**Stale queued share survives an immediate re-send, corrupting a contact's held share.**

`client/js/app.js` (btn-setup-recovery handler, immediate-send branch): sent the fresh
share to the live peer but never cleared any *previously queued* outbox entry for that
same contact. `queueRecoveryShareForContact` only dedups when queuing; the immediate
path didn't touch the outbox.

Failure scenario: setup run #1 queues a share for an offline contact C (split #1).
Setup run #2 re-splits (new polynomial) and C is now the live peer, so a fresh share
(split #2) is sent immediately -- but the stale split-#1 entry is still in the outbox.
When C later reconnects, `drainRecoveryShareOutboxForPeer` delivers the stale split-#1
share, and `saveTrustedShare`'s overwrite-on-save (`put`, keyed by ownerFingerprint)
replaces the fresh split-#2 share with the stale one. C now holds an incompatible share
relative to every other trusted contact -- recovery silently fails at reconstruction.

Fix: added `dequeueRecoveryShareForContact` and call it from the immediate-send branch
right after sending, so a contact can never simultaneously have both a just-sent share
and a stale queued one.

## Nice-to-have (1 finding, fixed this iteration)

**`x` not bounded by `totalShares` on receive** (`client/js/recoveryShare.js`,
`parseRecoveryShareAnnounce`): accepted any `x` in `[1,255]` regardless of `totalShares`
(e.g. `x=200, totalShares=5`). Not exploitable (Shamir's information-theoretic guarantee
already makes a below-threshold/inconsistent share useless), but self-inconsistent
announces should be rejected outright. Added `if (x > totalShares) return null;` plus a
regression test.

## Nice-to-have (not fixed, explicitly deferred)

**Received `y` length not checked against 32 bytes**: any nonzero length passes
`parseRecoveryShareAnnounce`. Cosmetic given the below-threshold uselessness guarantee --
a wrong-length share just produces garbage at combine time in S3 (recovery flow, not yet
built), same failure mode as any other malformed/incompatible share. Left as-is; S3 can
add stronger validation once the recovery UI defines what "32 bytes" means end-to-end.

## Checked and clean

- **Secret-scalar leak**: no leak. `scalar`/`identityRaw`/`extractableKey` are handler-
  local and go out of scope after `btn-setup-recovery` runs; the passphrase input is
  cleared immediately after `exportRawIdentity`; the text-export area and status text
  contain only per-contact `encodeShareAsText(share)` fragments (individual shares, each
  useless below threshold), never the raw scalar.
- **Receive gate**: `recovery-share-announce`'s gate in `handleChatMessage` is
  byte-identical to `device-list-announce`'s (`!state.peerFingerprint ||
  !state.identityKeyPair || !state.identityKeyPair.vaultKey`), same position (first line
  of the handler, before parsing).
- **Persistence**: `trustedShares.js` uses real IndexedDB via `db.js`, not memory.
  `DB_VERSION` 1->2 with idempotent `onupgradeneeded` (guarded by
  `objectStoreNames.contains`) correctly upgrades existing v1 databases without dropping
  `profile`/`contacts`/`messages`.
- **Overwrite-on-re-split**: `saveTrustedShare` -> `put` keyed by `ownerFingerprint`
  correctly replaces a prior share for the same owner; matches the documented
  accepted-limitation comment in `trustedShares.js`.
- **Outbox keying**: `recoveryShareOutboxKey(state.senderKey)` namespaces per local
  profile; `drainRecoveryShareOutboxForPeer` removes the entry after send; dedup on
  queue guarantees at most one entry per contact. Correct once combined with this
  iteration's dequeue-on-immediate-send fix.
- **XSS/DOM injection**: all contact nicknames/fingerprints rendered via `textContent`;
  `innerHTML` only ever set to `""` to clear. No injection surface.

## Convergence

Both findings from this iteration (the must-fix outbox race and the nice-to-have `x`
bound) were fixed directly (evidence above), verified by re-running the full test suite
(575/575 green after the fixes, up from 574/574 immediately post-implementation and
551/551 baseline before this section). No further review iteration requested -- the
fixes are small, mechanical, and directly address the reviewer's exact quoted code
paths with no ambiguity requiring a second independent pass.
