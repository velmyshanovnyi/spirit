// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { recoverFromShares } from "../js/socialRecovery.js";
import { splitSecret } from "../js/shamir.js";
import { encodeShareAsText } from "../js/recoveryShare.js";

const SECRET = new Uint8Array(32).map((_, i) => i + 1);

function textShares({ threshold = 3, shares = 5 } = {}, secret = SECRET) {
  return splitSecret(secret, { threshold, shares }).map((s) => encodeShareAsText({ ...s, threshold, totalShares: shares }));
}

describe("recoverFromShares", () => {
  it("recovers the original scalar from exactly `threshold` consistent shares", () => {
    const texts = textShares({ threshold: 3, shares: 5 });
    const result = recoverFromShares(texts.slice(0, 3));
    expect(result.ok).toBe(true);
    expect(result.scalar).toEqual(SECRET);
  });

  it("recovers the original scalar from more than `threshold` consistent shares", () => {
    const texts = textShares({ threshold: 3, shares: 5 });
    const result = recoverFromShares(texts);
    expect(result.ok).toBe(true);
    expect(result.scalar).toEqual(SECRET);
  });

  it("rejects shares from two different split cycles (mismatched threshold/totalShares) BEFORE combining", () => {
    const setA = textShares({ threshold: 3, shares: 5 });
    const setB = textShares({ threshold: 2, shares: 4 }, new Uint8Array(32).fill(9));
    const result = recoverFromShares([setA[0], setA[1], setB[0]]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("inconsistent");
  });

  it("rejects when fewer than `threshold` distinct shares are supplied, without calling combineShares", () => {
    const texts = textShares({ threshold: 3, shares: 5 });
    const result = recoverFromShares(texts.slice(0, 2));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient");
  });

  it("de-dupes a repeated share (same x pasted twice) rather than miscounting it as extra", () => {
    const texts = textShares({ threshold: 3, shares: 5 });
    const result = recoverFromShares([texts[0], texts[0], texts[1]]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient");
  });

  it("rejects a malformed share-text string with a clear per-item error", () => {
    const texts = textShares({ threshold: 3, shares: 5 });
    const result = recoverFromShares([texts[0], "not-a-share", texts[2]]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed");
    expect(result.detail).toBe("not-a-share");
  });

  it("rejects empty input", () => {
    expect(recoverFromShares([]).ok).toBe(false);
    expect(recoverFromShares([]).reason).toBe("empty");
    expect(recoverFromShares(["", "   "]).reason).toBe("empty");
  });

  it("ignores blank lines mixed in with valid share text", () => {
    const texts = textShares({ threshold: 2, shares: 3 });
    const result = recoverFromShares(["", texts[0], "  ", texts[1]]);
    expect(result.ok).toBe(true);
  });
});
