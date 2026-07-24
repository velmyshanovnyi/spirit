import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createGroup,
  getGroup,
  listGroups,
  updateGroupMembers,
  deleteGroup,
  ensureGroupBootstrap
} from "../js/groups.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

const FP_A = "a".repeat(64);
const FP_B = "b".repeat(64);
const FP_C = "c".repeat(64);

describe("createGroup", () => {
  it("generates a groupId, stores and returns the record", async () => {
    const before = Date.now();
    const group = await createGroup({ name: "Друзі", memberFingerprints: [FP_A, FP_B] });
    const after = Date.now();

    expect(typeof group.groupId).toBe("string");
    expect(group.groupId.length).toBeGreaterThan(0);
    expect(group.name).toBe("Друзі");
    expect(group.memberFingerprints).toEqual([FP_A, FP_B]);
    expect(group.createdAt).toBeGreaterThanOrEqual(before);
    expect(group.createdAt).toBeLessThanOrEqual(after);

    expect(await getGroup(group.groupId)).toEqual(group);
  });

  it("generates a unique groupId per call even with identical name/members", async () => {
    const g1 = await createGroup({ name: "Same", memberFingerprints: [FP_A] });
    const g2 = await createGroup({ name: "Same", memberFingerprints: [FP_A] });

    expect(g1.groupId).not.toBe(g2.groupId);
    expect(await listGroups()).toHaveLength(2);
  });
});

describe("getGroup", () => {
  it("returns undefined for an unknown groupId", async () => {
    expect(await getGroup("no-such-group")).toBeUndefined();
  });
});

describe("listGroups", () => {
  it("returns an empty array when no group has been created", async () => {
    expect(await listGroups()).toEqual([]);
  });

  it("returns every created group", async () => {
    const g1 = await createGroup({ name: "One", memberFingerprints: [FP_A] });
    const g2 = await createGroup({ name: "Two", memberFingerprints: [FP_B, FP_C] });

    const groups = await listGroups();

    expect(groups.map((g) => g.groupId).sort()).toEqual([g1.groupId, g2.groupId].sort());
  });
});

describe("updateGroupMembers", () => {
  it("replaces memberFingerprints without touching groupId/name/createdAt", async () => {
    const group = await createGroup({ name: "Друзі", memberFingerprints: [FP_A, FP_B] });

    await updateGroupMembers(group.groupId, [FP_A, FP_B, FP_C]);

    const updated = await getGroup(group.groupId);
    expect(updated.memberFingerprints).toEqual([FP_A, FP_B, FP_C]);
    expect(updated.groupId).toBe(group.groupId);
    expect(updated.name).toBe(group.name);
    expect(updated.createdAt).toBe(group.createdAt);
  });

  it("throws for an unknown groupId instead of creating an orphan record", async () => {
    await expect(updateGroupMembers("no-such-group", [FP_A])).rejects.toThrow(/unknown group/i);
  });
});

describe("deleteGroup", () => {
  it("removes the record -- a second getGroup after delete returns undefined", async () => {
    const group = await createGroup({ name: "Друзі", memberFingerprints: [FP_A] });

    await deleteGroup(group.groupId);

    expect(await getGroup(group.groupId)).toBeUndefined();
    expect(await listGroups()).toEqual([]);
  });
});

describe("ensureGroupBootstrap (Section GC4 fix)", () => {
  it("writes a record under the EXACT groupId given, not a freshly minted one", async () => {
    const group = await ensureGroupBootstrap("given-group-id", { name: "Unnamed group", memberFingerprints: [FP_A, FP_B] });

    expect(group.groupId).toBe("given-group-id");
    expect(await getGroup("given-group-id")).toEqual(group);
  });

  it("never overwrites an already-existing record for that groupId", async () => {
    const original = await createGroup({ name: "Друзі", memberFingerprints: [FP_A, FP_B, FP_C] });

    const result = await ensureGroupBootstrap(original.groupId, { name: "Unnamed group", memberFingerprints: [FP_A] });

    expect(result).toEqual(original);
    expect(await getGroup(original.groupId)).toEqual(original);
  });
});
