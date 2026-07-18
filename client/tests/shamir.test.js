import { describe, it, expect } from "vitest";
import {
  splitSecret,
  combineShares,
  gfAdd,
  gfMul,
  gfInverse,
} from "../js/shamir.js";

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

describe("GF(256) arithmetic", () => {
  it("gfAdd is XOR", () => {
    expect(gfAdd(0x53, 0xca)).toBe(0x53 ^ 0xca);
    expect(gfAdd(0x00, 0xff)).toBe(0xff);
    expect(gfAdd(0xff, 0xff)).toBe(0x00);
  });

  it("gfMul matches known AES/Reed-Solomon GF(256) reference values", () => {
    // Standard AES field (poly 0x11B) reference products, independently
    // verifiable (e.g. AES MixColumns constants / textbook GF(256) tables).
    expect(gfMul(0x02, 0x02)).toBe(0x04);
    expect(gfMul(0x02, 0x80)).toBe(0x1b); // classic "xtime" reduction case
    expect(gfMul(0x02, 0x87)).toBe(0x15);
    expect(gfMul(0x53, 0xca)).toBe(0x01); // AES S-box inverse-related identity
    expect(gfMul(0x00, 0x99)).toBe(0x00);
    expect(gfMul(0x01, 0x99)).toBe(0x99);
  });

  it("gfMul is commutative", () => {
    for (let i = 0; i < 50; i++) {
      const a = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      expect(gfMul(a, b)).toBe(gfMul(b, a));
    }
  });

  it("gfInverse is correct for every nonzero element (exhaustive)", () => {
    for (let a = 1; a < 256; a++) {
      const inv = gfInverse(a);
      expect(gfMul(a, inv)).toBe(1);
    }
  });

  it("gfInverse(0) throws (0 has no multiplicative inverse)", () => {
    expect(() => gfInverse(0)).toThrow();
  });
});

describe("splitSecret / combineShares round-trip", () => {
  it("recovers exact original bytes from exactly threshold shares", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    expect(shares.length).toBe(5);

    const recovered = combineShares(shares.slice(0, 3));
    expect([...recovered]).toEqual([...secret]);
  });

  it("recovers from any subset of threshold shares, not just the first ones", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 6 });

    const subsets = [
      [shares[3], shares[4], shares[5]],
      [shares[0], shares[2], shares[5]],
      [shares[1], shares[3], shares[4]],
    ];

    for (const subset of subsets) {
      const recovered = combineShares(subset);
      expect([...recovered]).toEqual([...secret]);
    }
  });

  it("works with more than threshold shares supplied", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    const recovered = combineShares(shares); // all 5
    expect([...recovered]).toEqual([...secret]);
  });

  it("fewer than threshold shares does NOT recover the correct secret (no throw, wrong bytes)", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 4, shares: 6 });

    const recovered = combineShares(shares.slice(0, 3)); // threshold - 1
    expect(recovered.length).toBe(secret.length);
    expect([...recovered]).not.toEqual([...secret]);
  });

  it("combineShares result is independent of share order", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 3, shares: 5 });
    const subset = [shares[4], shares[0], shares[2]];
    const shuffled = [shares[2], shares[4], shares[0]];

    const recovered1 = combineShares(subset);
    const recovered2 = combineShares(shuffled);
    expect([...recovered1]).toEqual([...recovered2]);
    expect([...recovered1]).toEqual([...secret]);
  });

  it("handles a realistic 32-byte identity-scalar-sized secret", () => {
    const secret = randomBytes(32);
    const shares = splitSecret(secret, { threshold: 2, shares: 3 });
    const recovered = combineShares([shares[1], shares[2]]);
    expect([...recovered]).toEqual([...secret]);
  });

  it("two splitSecret calls on the same secret produce different shares but both reconstruct it", () => {
    const secret = randomBytes(16);
    const sharesA = splitSecret(secret, { threshold: 2, shares: 3 });
    const sharesB = splitSecret(secret, { threshold: 2, shares: 3 });

    // Freshness: at least one y-array differs between the two independent runs.
    const anyDifferent = sharesA.some((shareA, i) => {
      const shareB = sharesB[i];
      return [...shareA.y].some((byte, j) => byte !== shareB.y[j]);
    });
    expect(anyDifferent).toBe(true);

    expect([...combineShares(sharesA.slice(0, 2))]).toEqual([...secret]);
    expect([...combineShares(sharesB.slice(0, 2))]).toEqual([...secret]);
  });

  it("no share uses x=0 (reserved for the secret itself)", () => {
    const secret = randomBytes(8);
    const shares = splitSecret(secret, { threshold: 2, shares: 10 });
    for (const share of shares) {
      expect(share.x).not.toBe(0);
    }
  });

  it("all shares have distinct x-coordinates", () => {
    const secret = randomBytes(8);
    const shares = splitSecret(secret, { threshold: 3, shares: 20 });
    const xs = shares.map((s) => s.x);
    expect(new Set(xs).size).toBe(xs.length);
  });

  it("throws when threshold > shares", () => {
    const secret = randomBytes(8);
    expect(() => splitSecret(secret, { threshold: 5, shares: 3 })).toThrow();
  });

  it("throws when threshold < 2", () => {
    const secret = randomBytes(8);
    expect(() => splitSecret(secret, { threshold: 1, shares: 3 })).toThrow();
    expect(() => splitSecret(secret, { threshold: 0, shares: 3 })).toThrow();
  });

  it("throws on empty secret", () => {
    expect(() =>
      splitSecret(new Uint8Array(0), { threshold: 2, shares: 3 })
    ).toThrow();
  });

  it("throws when shares > 255 (only 255 nonzero x-coordinates exist in GF(256))", () => {
    const secret = randomBytes(8);
    expect(() =>
      splitSecret(secret, { threshold: 2, shares: 256 })
    ).toThrow();
  });

  it("combineShares throws on empty input", () => {
    expect(() => combineShares([])).toThrow();
  });
});
