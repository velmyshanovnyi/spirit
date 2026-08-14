// Section SR1 (specs/phase5/sybil-resistance.md): stateless hashcash-like
// proof-of-work crypto core for create_invite anti-Sybil protection. Pure
// functions only -- no network I/O, no wiring into signalingClient.js's
// live create_invite flow (that's Section SR2). Mirrors server/library/Pow.php
// exactly: both sides must agree bit-for-bit on the leading-zero-bit count
// over the SAME SHA-256 digest bytes for the SAME challenge+nonce inputs.

/**
 * Builds the PoW challenge string exactly as the server reconstructs it:
 * "${timeWindow}:${senderKey}". Byte-identical to PHP's
 * "{$timeWindow}:{$senderKey}" string concatenation (both are plain ASCII/
 * UTF-8 text, no implicit type coercion surprises since timeWindow is always
 * passed in as a number here and cast to a decimal string the same way
 * PHP's string interpolation would).
 *
 * @param {number} timeWindow floor(unixTime / POW_WINDOW_SECONDS)
 * @param {string} senderKey the identity key this PoW is bound to
 * @returns {string}
 */
export function buildPowChallenge(timeWindow, senderKey) {
  return `${timeWindow}:${senderKey}`;
}

/**
 * Counts leading zero BITS (not bytes) in a byte buffer, scanning
 * most-significant-bit-first within each byte -- standard big-endian bit
 * order for both crypto.subtle.digest's ArrayBuffer output and PHP's
 * hash(..., true) raw binary string. Returns the total bit-length if every
 * bit is zero (all-zero digest, astronomically unlikely but handled
 * correctly rather than relying on it never occurring).
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function countLeadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte >> bit) & 1) {
        return count;
      }
      count++;
    }
  }
  return count;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/**
 * Verifies that SHA-256(challenge + ":" + nonce) has at least
 * difficultyBits leading zero bits. Mirrors Spirit\Pow::verify() in
 * server/library/Pow.php exactly (same concatenation, same digest, same
 * bit-counting logic) -- used both as the client's own self-check before
 * submitting a solved PoW, and directly by tests.
 *
 * @param {string} challenge
 * @param {string} nonce
 * @param {number} difficultyBits
 * @returns {Promise<boolean>}
 */
export async function verifyPow(challenge, nonce, difficultyBits) {
  const digestBytes = await sha256(`${challenge}:${nonce}`);
  return countLeadingZeroBits(digestBytes) >= difficultyBits;
}

// Safety cap on solvePow's brute-force loop so a pathologically high
// difficulty (or a bug that makes verifyPow never pass) can't hang a test
// run or a real client forever. At the spec's recommended PRODUCTION
// difficulty of 20 bits, the EXPECTED attempt count is ~2^20 (~1M); this
// default gives ~16x that expectation (2^24 ≈ 16.7M attempts) as headroom
// against unlucky runs, while still bounding worst-case wall-clock time.
// Callers solving at a non-default (e.g. test-only low) difficulty should
// pass an explicit maxAttempts appropriate to that difficulty instead of
// relying on this default.
const DEFAULT_MAX_ATTEMPTS = 2 ** 24;

// Upper bound for the randomized default search start (see solvePow below).
// Kept well under Number.MAX_SAFE_INTEGER so `startAttempt + attempt`
// arithmetic across DEFAULT_MAX_ATTEMPTS iterations never loses precision.
const RANDOM_START_RANGE = 2 ** 32;

/**
 * Picks a random starting attempt for solvePow's search -- see solvePow's
 * doc comment for why this matters (SR2 exec-review finding,
 * specs/reviews/sybil-resistance-SR2-iter1.md): a fixed start of 0 made
 * solvePow fully deterministic for a given (challenge, difficultyBits),
 * which collided with SR2's server-side anti-replay whenever the same
 * identity legitimately created two invites within the same time window.
 */
function randomStartAttempt() {
  return crypto.getRandomValues(new Uint32Array(1))[0] % RANDOM_START_RANGE;
}

// Number of candidate nonces hashed concurrently per round (see solvePow's
// doc comment for why this matters -- found via live browser verification,
// 2026-07-18: awaiting crypto.subtle.digest one candidate at a time has
// real per-call dispatch overhead that made a real solve at the production
// difficulty (20 bits, ~2^20 expected attempts) take 30+ seconds in a real
// browser instead of the assumed sub-second. Batching hides that dispatch
// latency behind concurrency -- same total hash work, far less wall time.
const DEFAULT_BATCH_SIZE = 256;

// Backlog A1 (docs/backlog.md): batching above fixed hash THROUGHPUT but not
// main-thread STARVATION. `await Promise.all(...)` in a tight loop only ever
// queues microtasks, and the microtask queue is fully drained before the macrotask
// queue gets any turn -- so timers, rendering and input events are all frozen
// for the entire solve. Live-measured on spirit.kolo.media 2026-08-08: ZERO
// setTimeout callbacks fired during a 5.6s solve, i.e. the whole UI (loading
// spinner included) was dead on every fresh visit, since the zero-click
// ephemeral auto-start calls createInvite -> solvePow immediately on load.
//
// Yielding a real MACROtask once per batch fixes it. Mechanism matters here:
// measured A/B in a real browser over identical work (92 batches, same
// winning nonce) --
//   no yield                  460ms, 0 timers fired
//   setTimeout(0) per batch   907ms (+97%: nested setTimeout is clamped to
//                             ~4ms by every browser), 75 timers fired
//   MessageChannel per batch  494ms (+7%), 28 timers fired, max lag 12ms
// MessageChannel is a genuine macrotask with no clamping, so it costs ~7%
// instead of ~97% for the same responsiveness.
let yieldChannel = null;
const yieldResolvers = [];

/**
 * Resolves on a fresh MACROtask, letting the browser service timers,
 * rendering and input between PoW batches. Falls back to setTimeout where
 * MessageChannel is unavailable (the clamping cost is irrelevant there --
 * correctness first).
 */
function macrotaskYield() {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!yieldChannel) {
    yieldChannel = new MessageChannel();
    // One shared channel + a FIFO resolver queue rather than a new channel
    // per yield: each postMessage delivers exactly one message and shifts
    // exactly one resolver, so concurrent solves interleave safely instead
    // of clobbering a single onmessage handler.
    yieldChannel.port1.onmessage = () => {
      yieldResolvers.shift()?.();
      // Idle again -- stop holding Node's event loop open (see below).
      if (yieldResolvers.length === 0) yieldChannel.port1.unref?.();
    };
    yieldChannel.port1.unref?.();
  }
  return new Promise((resolve) => {
    yieldResolvers.push(resolve);
    // ref/unref dance, verified in plain Node (browsers have neither method,
    // so both calls are no-ops there):
    //   - unref'd for the whole life  -> Node exits BEFORE delivering the
    //     message, so this promise never settles and solvePow silently
    //     hangs ("Detected unsettled top-level await", exit 13). A promise
    //     alone does not keep Node's event loop alive.
    //   - never unref'd               -> delivery is correct, but the live
    //     port keeps the loop alive forever and the process/test runner
    //     never exits (measured: hung until killed).
    // Holding a ref only while a yield is actually outstanding gives both
    // correct delivery and a clean exit.
    yieldChannel.port1.ref?.();
    yieldChannel.port2.postMessage(0);
  });
}

/**
 * Brute-forces nonces (stringified increasing integers, starting from a
 * randomized offset by default -- see randomStartAttempt) until
 * verifyPow(challenge, nonce, difficultyBits) succeeds, returning the
 * winning nonce as a string ready to send in create_invite's pow_nonce
 * field. Randomizing the start means two solves of the IDENTICAL challenge
 * (e.g. the same identity calling create_invite twice within the same PoW
 * time window) produce different nonces with overwhelming probability,
 * while each nonce independently still satisfies verifyPow -- required so
 * server-side per-(timeWindow, senderKey, nonce) anti-replay
 * (server/library/PowNonceStore.php) doesn't reject a second, otherwise
 * legitimate, create_invite call as a false-positive "replay". Pass an
 * explicit startAttempt (e.g. 0) for deterministic behavior, as tests do.
 *
 * Candidates are hashed in concurrent batches of `batchSize` (via
 * Promise.all) rather than one at a time -- see DEFAULT_BATCH_SIZE. Within
 * and across batches, candidates are still scanned in strictly increasing
 * nonce order and the FIRST satisfying nonce found is returned, so behavior
 * (including full determinism when startAttempt is given explicitly) is
 * unchanged from a purely sequential search -- only wall-clock time differs.
 *
 * @param {string} challenge
 * @param {number} difficultyBits
 * @param {{maxAttempts?: number, startAttempt?: number, batchSize?: number, yieldFn?: () => Promise<void>}} [options]
 * @returns {Promise<string>}
 * @throws {Error} if no solution is found within maxAttempts
 */
export async function solvePow(
  challenge,
  difficultyBits,
  {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    startAttempt = randomStartAttempt(),
    batchSize = DEFAULT_BATCH_SIZE,
    // Injectable purely so tests can assert the yield CONTRACT (see
    // pow.test.js): under Node, crypto.subtle's own promise resolution
    // already returns to the macrotask queue between awaits, so the
    // starvation this guards against is unobservable there and a
    // behavioral assertion would pass with or without the fix.
    yieldFn = macrotaskYield
  } = {}
) {
  for (let base = 0; base < maxAttempts; base += batchSize) {
    const count = Math.min(batchSize, maxAttempts - base);
    const candidates = Array.from({ length: count }, (_, k) => String(startAttempt + base + k));
    const digests = await Promise.all(candidates.map((nonce) => sha256(`${challenge}:${nonce}`)));
    for (let k = 0; k < count; k++) {
      if (countLeadingZeroBits(digests[k]) >= difficultyBits) {
        return candidates[k];
      }
    }
    // After the batch, never before returning a hit -- a solved PoW should
    // resolve immediately rather than pay an extra macrotask hop.
    await yieldFn();
  }
  throw new Error(
    `solvePow: no nonce found satisfying difficultyBits=${difficultyBits} within maxAttempts=${maxAttempts}`
  );
}
