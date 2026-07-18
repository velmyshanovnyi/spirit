import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { saveTrustedShare, getTrustedShare, listTrustedShares, deleteTrustedShare } from "../js/trustedShares.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

const OWNER_FP = "a".repeat(64);
const OTHER_FP = "b".repeat(64);

function makeShare(overrides = {}) {
  return {
    ownerFingerprint: OWNER_FP,
    x: 3,
    y: new Uint8Array([1, 2, 3, 4]),
    threshold: 2,
    totalShares: 3,
    receivedAt: 1000,
    ...overrides
  };
}

describe("saveTrustedShare / getTrustedShare", () => {
  it("stores a share keyed by ownerFingerprint and reads it back", async () => {
    const share = makeShare();
    await saveTrustedShare(share);
    expect(await getTrustedShare(OWNER_FP)).toEqual(share);
  });

  it("returns undefined for an unknown owner", async () => {
    expect(await getTrustedShare("f".repeat(64))).toBeUndefined();
  });

  it("re-announcing the same owner OVERWRITES the prior share (fresh split invalidates the old threshold/total)", async () => {
    await saveTrustedShare(makeShare({ x: 3, threshold: 2, totalShares: 3, receivedAt: 1000 }));
    const fresh = makeShare({ x: 1, threshold: 3, totalShares: 5, receivedAt: 2000 });
    await saveTrustedShare(fresh);
    expect(await getTrustedShare(OWNER_FP)).toEqual(fresh);
  });

  it("keeps shares from different owners independent", async () => {
    const a = makeShare({ ownerFingerprint: OWNER_FP });
    const b = makeShare({ ownerFingerprint: OTHER_FP, x: 7 });
    await saveTrustedShare(a);
    await saveTrustedShare(b);
    expect(await getTrustedShare(OWNER_FP)).toEqual(a);
    expect(await getTrustedShare(OTHER_FP)).toEqual(b);
  });
});

describe("listTrustedShares", () => {
  it("returns an empty array when nothing is stored", async () => {
    expect(await listTrustedShares()).toEqual([]);
  });

  it("returns every stored share", async () => {
    const a = makeShare({ ownerFingerprint: OWNER_FP });
    const b = makeShare({ ownerFingerprint: OTHER_FP, x: 7 });
    await saveTrustedShare(a);
    await saveTrustedShare(b);
    const all = await listTrustedShares();
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([a, b]));
  });
});

describe("deleteTrustedShare", () => {
  it("removes a stored share", async () => {
    await saveTrustedShare(makeShare());
    await deleteTrustedShare(OWNER_FP);
    expect(await getTrustedShare(OWNER_FP)).toBeUndefined();
  });

  it("is a no-op for an unknown owner", async () => {
    await expect(deleteTrustedShare("f".repeat(64))).resolves.not.toThrow();
  });
});
