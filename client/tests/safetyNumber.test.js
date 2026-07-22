// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeSharedSafetyNumber, hexToEmoji } from "../js/safetyNumber.js";

describe("computeSharedSafetyNumber", () => {
  it("is order-independent (same result regardless of which fingerprint is 'mine' vs 'theirs')", async () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const fromA = await computeSharedSafetyNumber(a, b);
    const fromB = await computeSharedSafetyNumber(b, a);
    expect(fromA).toBe(fromB);
  });

  it("produces different values for different fingerprint pairs", async () => {
    const shared1 = await computeSharedSafetyNumber("a".repeat(64), "b".repeat(64));
    const shared2 = await computeSharedSafetyNumber("a".repeat(64), "c".repeat(64));
    expect(shared1).not.toBe(shared2);
  });

  it("is deterministic for the same pair", async () => {
    const first = await computeSharedSafetyNumber("a".repeat(64), "b".repeat(64));
    const second = await computeSharedSafetyNumber("a".repeat(64), "b".repeat(64));
    expect(first).toBe(second);
  });
});

describe("hexToEmoji", () => {
  it("returns a sequence of the requested emoji count, space-separated", () => {
    const result = hexToEmoji("a".repeat(64), 5);
    expect(result.split(" ")).toHaveLength(5);
  });

  it("is deterministic for the same input", () => {
    expect(hexToEmoji("deadbeef")).toBe(hexToEmoji("deadbeef"));
  });

  it("produces different output for different input", () => {
    expect(hexToEmoji("a".repeat(64))).not.toBe(hexToEmoji("b".repeat(64)));
  });

  it("handles a short hex string without throwing", () => {
    expect(() => hexToEmoji("ab")).not.toThrow();
  });
});
