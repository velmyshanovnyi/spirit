---
spec: docs/backlog.md (A1)
section: A1 -- PoW main-thread starvation
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/pow.js
  - client/tests/pow.test.js
---

## Context

`solvePow` froze the browser's main thread for ~3–5 s on every fresh visit
(the zero-click ephemeral auto-start calls `createInvite` → `solvePow`
immediately on load). Live-measured: **zero** `setTimeout` callbacks fired
during a 5.6 s solve — the whole UI, including the loading spinner added
earlier this phase, was dead.

Root cause was **not** CPU: `await Promise.all(...)` in a tight loop only
queues microtasks, and the microtask queue is fully drained before the
macrotask queue gets any turn. Diagnosed by A/B in a real browser over
identical work (92 batches, same winning nonce):

| variant | time | timers fired | max lag |
|---|---|---|---|
| no yield | 460 ms | **0** | — |
| `setTimeout(0)` per batch | 907 ms (+97 %) | 75 | 18 ms |
| **MessageChannel per batch** | **494 ms (+7 %)** | 28 | **12 ms** |

`setTimeout(0)` is clamped to ~4 ms by every browser, hence the +97 %.
A Web Worker was considered and rejected as unnecessary once the cause was
known to be scheduling, not CPU.

## Verdict: CONVERGED (after fixes)

Reviewer verified empirically rather than by reading: 8 concurrent
`solvePow` calls sharing the module-global resolver queue all settled
correctly with determinism intact; the specific `push`+`ref` interleaving
race asked about is impossible (`resolve()` only schedules a microtask, so
no user code runs between `shift()` and the `length === 0` check); Node's
`ref`/`unref` are idempotent flags, so two-in-flight is handled correctly.

## Findings and resolutions

1. **F1, test quality (mutation-proven)**: the yield-contract test asserted
   `yieldCalls.length >= 2`, which does not pin the documented "never yield
   on the batch that found the hit" property. Reviewer built the mutant
   (yield moved above the found-nonce check): it produces 3 yields and the
   `>= 2` assertion still passed, so the property could regress silently.
   **Fixed**: `toBe(2)` (deterministic given `startAttempt: 0`, since 744
   lies in batch 3).
2. **F2, documentation**: the new `yieldFn` option was missing from
   `solvePow`'s JSDoc typedef. **Fixed**.

## Self-caught before review (worth recording)

The first implementation `unref()`-ed the MessagePort for its whole life to
avoid holding a test runner open. Probed in plain Node before shipping:
that **breaks correctness** — Node exits before delivering the message, the
yield promise never settles and `solvePow` hangs ("Detected unsettled
top-level await", exit 13). Never unref-ing is also wrong: delivery works
but the process/test runner never exits. Only ref-while-pending /
unref-when-idle satisfies both; a subprocess regression test now pins it
(vitest itself cannot observe either failure mode, because the runner keeps
the loop alive for its own reasons). Reviewer independently reproduced both
mutants: `ref` removed → exit 13 in 136 ms; `unref` removed → hang → SIGTERM
at 15 s; unmutated → `OK` in 253 ms. No zombie processes left behind.

## Notes carried into the backlog

- Perf scaling is difficulty-independent (~0.37 ms constant per yield), so
  the +7 % ratio holds. Deployed difficulty is 16 bits
  (`client/js/signalingClient.js`, `POW_DIFFICULTY_BITS`) ≈ 256 batches
  ≈ 95 ms of yield overhead.
- One extra yield occurs on `maxAttempts` exhaustion before throwing
  (~0.4 ms). Cosmetic, left as-is.
- Reviewer confirmed the `ICE gathering timeout` flake is **pre-existing and
  unrelated** (reproduced on a stashed clean tree, 3 of 4 runs; `app.test.js`
  fully mocks `signalingClient.js`, so `pow.js` is never loaded there).
  Recorded as new backlog item **A10**, to be done before/with A9 (CI), since
  flaky reds are the fastest way to teach a team to ignore CI.

## Live verification (post-deploy)

Verified on a host where the browser was confirmed to be running the NEW
module (compared a normal cache-honouring `fetch` against `cache:"no-store"`
before trusting any number):

- Main thread stays alive for the whole solve — 3 samples: **86 / 83 / 374**
  timer callbacks fired (was exactly **0**), max lag 34 / 28 / 80 ms.
- `DOMContentLoaded` **444 ms**, while the solves in those same samples took
  1.5 / 1.5 / 7.1 s — i.e. DCL is no longer coupled to the PoW at all.
- Solve time itself is unchanged and highly variable (1.5–7 s). The fix makes
  the PoW non-blocking, **not** faster.

### Correction to an earlier claim in this artifact

An earlier revision recorded "DOMContentLoaded 1452 ms, down from
3550–3787 ms" as the result of this fix. That was **wrong**: the page under
measurement was still executing the OLD `pow.js` out of the browser's HTTP
cache (proved by diffing a cached fetch against a `no-store` fetch — 8525 vs
11176 bytes for the sibling `router.js`, and `macrotaskYield` absent from the
cached `pow.js`). The 1452 ms was a lucky draw from PoW's random solve time,
not an effect of the fix. Corrected numbers above. The mechanism claim
(timers firing during the solve) was always sound, because that measurement
imported the module with a cache-busting query.

This is now recorded as backlog **A11**: post-deploy live verification can
silently exercise stale code, which undermines the project's own core
practice.
