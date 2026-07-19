// Section SR1 (specs/phase5/sybil-resistance.md): stateless hashcash-like
// proof-of-work crypto core for create_invite anti-Sybil protection. Pure
// functions only -- no network, no wiring into signalingClient.js yet
// (that's Section SR2).
import { describe, it, expect } from "vitest";
import { buildPowChallenge, verifyPow, solvePow } from "../js/pow.js";

// Cross-language test vectors: SHA-256("1000:testSenderKey:<nonce>"), leading
// zero BITS (not bytes) hand-computed via an independent Node script (not
// this codebase's own bit-counting code) and cross-checked against
// server/verify/section_pow.php, which asserts the SAME tuples through
// Pow::verify(). If either side's bit-counting or byte-encoding diverges,
// exactly one of the two files' assertions will fail on these tuples.
const CHALLENGE = "1000:testSenderKey";
const VECTORS = [
  // [nonce, exact leading-zero-bit count of SHA-256(`${CHALLENGE}:${nonce}`)]
  ["1", 0],
  ["36", 4],
  ["21", 8],
  ["11280", 12],
];

describe("buildPowChallenge", () => {
  it("produces the exact '${timeWindow}:${senderKey}' format", () => {
    expect(buildPowChallenge(1000, "testSenderKey")).toBe("1000:testSenderKey");
    expect(buildPowChallenge(0, "abc")).toBe("0:abc");
    expect(buildPowChallenge(42, "")).toBe("42:");
  });
});

describe("verifyPow", () => {
  it("agrees with hand-verified leading-zero-bit counts on known vectors", async () => {
    for (const [nonce, exactBits] of VECTORS) {
      expect(await verifyPow(CHALLENGE, nonce, exactBits)).toBe(true);
      expect(await verifyPow(CHALLENGE, nonce, exactBits + 1)).toBe(false);
    }
  });

  it("passes at difficulty 0 for any input (0 leading zero bits always satisfied)", async () => {
    expect(await verifyPow("anything", "whatever-nonce", 0)).toBe(true);
    expect(await verifyPow(CHALLENGE, "1", 0)).toBe(true);
  });

  it("fails at an unreachably high difficulty for any input", async () => {
    expect(await verifyPow(CHALLENGE, "1", 256)).toBe(false);
    expect(await verifyPow("random-challenge", "random-nonce", 255)).toBe(false);
  });
});

describe("solvePow", () => {
  // Low test-only difficulty (8-12 bits, expected ~2^8-2^12 attempts) so the
  // suite stays fast. The spec's recommended PRODUCTION difficulty is 20
  // bits (~2^20 expected attempts, sub-second via Web Crypto on real
  // hardware but far too slow for a test run at default maxAttempts speed).
  const TEST_DIFFICULTY_BITS = 8;

  it("returns a nonce that verifyPow accepts", async () => {
    const challenge = buildPowChallenge(12345, "solve-test-key");
    const nonce = await solvePow(challenge, TEST_DIFFICULTY_BITS);
    expect(typeof nonce).toBe("string");
    expect(await verifyPow(challenge, nonce, TEST_DIFFICULTY_BITS)).toBe(true);
  });

  it("throws when maxAttempts is too low to reach the target difficulty", async () => {
    const challenge = buildPowChallenge(1, "unsolvable-in-time");
    // maxAttempts=1 against 32 bits is astronomically unlikely to succeed by
    // chance (~1 in 4 billion), so this deterministically exercises the cap.
    await expect(solvePow(challenge, 32, { maxAttempts: 1 })).rejects.toThrow();
  });

  // Section SR2 exec-review finding (specs/reviews/sybil-resistance-SR2-iter1.md):
  // solvePow used to be fully deterministic (always start searching from
  // nonce "0") for a given (challenge, difficultyBits), which meant two
  // create_invite calls from the SAME identity within the SAME 30s time
  // window (identical challenge = "${timeWindow}:${senderKey}") always
  // produced the identical nonce -- and SR2's server-side anti-replay then
  // rejected the second, otherwise-completely-legitimate call as a "replay".
  // solvePow now randomizes its search start by default so repeated solves
  // of the same challenge produce different nonces (while each nonce still
  // independently satisfies verifyPow, so server-side verification is
  // unaffected).
  it("produces a different nonce on repeated calls with the identical challenge (randomized search start)", async () => {
    const challenge = buildPowChallenge(99, "same-identity-key");
    const nonce1 = await solvePow(challenge, TEST_DIFFICULTY_BITS);
    const nonce2 = await solvePow(challenge, TEST_DIFFICULTY_BITS);
    expect(nonce1).not.toBe(nonce2);
    expect(await verifyPow(challenge, nonce1, TEST_DIFFICULTY_BITS)).toBe(true);
    expect(await verifyPow(challenge, nonce2, TEST_DIFFICULTY_BITS)).toBe(true);
  });

  it("is fully deterministic when an explicit startAttempt is given (regression control)", async () => {
    const challenge = buildPowChallenge(1, "explicit-start-key");
    const nonce1 = await solvePow(challenge, TEST_DIFFICULTY_BITS, { startAttempt: 0 });
    const nonce2 = await solvePow(challenge, TEST_DIFFICULTY_BITS, { startAttempt: 0 });
    expect(nonce1).toBe(nonce2);
  });

  // Live-verification bug (found post-deploy, 2026-07-18): the original loop
  // did `for (...) { await verifyPow(...) }`, awaiting crypto.subtle.digest
  // ONE candidate at a time. Each await has real per-call dispatch overhead
  // in a real browser; at the spec's recommended production difficulty of
  // 20 bits (~2^20 expected attempts) this made a real create_invite click
  // hang for 30+ seconds instead of the assumed sub-second solve. Fixed by
  // dispatching candidates in concurrent batches via Promise.all. This test
  // guards against reintroducing the fully-sequential-await pattern: at a
  // moderately high difficulty it must still complete well within a
  // generous wall-clock bound, not just be logically correct.
  it(
    "solves a moderately-high-difficulty challenge within a generous wall-clock bound (concurrent batching regression guard)",
    async () => {
      const REGRESSION_DIFFICULTY_BITS = 16; // ~65536 expected attempts
      const challenge = buildPowChallenge(1, "perf-regression-key");
      const startedAt = Date.now();
      const nonce = await solvePow(challenge, REGRESSION_DIFFICULTY_BITS);
      const elapsedMs = Date.now() - startedAt;
      expect(await verifyPow(challenge, nonce, REGRESSION_DIFFICULTY_BITS)).toBe(true);
      // Generous bound: batched solving should comfortably finish in well
      // under this on any real test runner; the fully-sequential-await
      // version this guards against took tens of seconds at 20 bits (4x this
      // difficulty). 15s leaves ample headroom for a loaded/shared CI sandbox
      // (observed flaky at vitest's default 5s test timeout under concurrent
      // test-suite load) while still failing hard if the sequential-await
      // bug were ever reintroduced. The explicit third-argument timeout
      // below raises vitest's own per-test timeout to match -- the 15000ms
      // assertion bound is meaningless if the test itself gets killed at
      // vitest's default 5000ms first (exactly what happened before this).
      expect(elapsedMs).toBeLessThan(15000);
    },
    20000
  );
});
