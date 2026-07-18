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
});
