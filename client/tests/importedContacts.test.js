import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  saveImportedContact,
  listImportedContacts,
  getImportedContact,
  setMatchedFingerprint,
  deleteImportedContact
} from "../js/importedContacts.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

const FP_A = "a".repeat(64);

describe("saveImportedContact", () => {
  it("generates an id, stores and returns the record with matchedFingerprint null", async () => {
    const before = Date.now();
    const record = await saveImportedContact({
      displayName: "Іван Петренко",
      sourceIdentifier: "+380501234567",
      source: "telegram-json"
    });
    const after = Date.now();

    expect(typeof record.id).toBe("string");
    expect(record.id.length).toBeGreaterThan(0);
    expect(record.displayName).toBe("Іван Петренко");
    expect(record.sourceIdentifier).toBe("+380501234567");
    expect(record.source).toBe("telegram-json");
    expect(record.matchedFingerprint).toBeNull();
    expect(record.importedAt).toBeGreaterThanOrEqual(before);
    expect(record.importedAt).toBeLessThanOrEqual(after);

    expect(await getImportedContact(record.id)).toEqual(record);
  });

  it("generates a unique id per call even with identical fields", async () => {
    const r1 = await saveImportedContact({ displayName: "A", sourceIdentifier: "1", source: "vcard" });
    const r2 = await saveImportedContact({ displayName: "A", sourceIdentifier: "1", source: "vcard" });

    expect(r1.id).not.toBe(r2.id);
    expect(await listImportedContacts()).toHaveLength(2);
  });
});

describe("getImportedContact", () => {
  it("returns undefined for an unknown id", async () => {
    expect(await getImportedContact("no-such-id")).toBeUndefined();
  });
});

describe("listImportedContacts", () => {
  it("returns an empty array when nothing has been imported", async () => {
    expect(await listImportedContacts()).toEqual([]);
  });

  it("returns every saved record", async () => {
    const r1 = await saveImportedContact({ displayName: "One", sourceIdentifier: "1", source: "vcard" });
    const r2 = await saveImportedContact({ displayName: "Two", sourceIdentifier: "2", source: "whatsapp" });

    const records = await listImportedContacts();

    expect(records.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
  });
});

describe("setMatchedFingerprint", () => {
  it("updates only matchedFingerprint, leaving other fields untouched", async () => {
    const record = await saveImportedContact({ displayName: "Іван", sourceIdentifier: "1", source: "vcard" });

    await setMatchedFingerprint(record.id, FP_A);

    const updated = await getImportedContact(record.id);
    expect(updated.matchedFingerprint).toBe(FP_A);
    expect(updated.id).toBe(record.id);
    expect(updated.displayName).toBe(record.displayName);
    expect(updated.sourceIdentifier).toBe(record.sourceIdentifier);
    expect(updated.source).toBe(record.source);
    expect(updated.importedAt).toBe(record.importedAt);
  });

  it("throws for an unknown id instead of creating an orphan record", async () => {
    await expect(setMatchedFingerprint("no-such-id", FP_A)).rejects.toThrow(/unknown imported contact/i);
  });
});

describe("deleteImportedContact", () => {
  it("removes the record -- a second getImportedContact after delete returns undefined", async () => {
    const record = await saveImportedContact({ displayName: "Іван", sourceIdentifier: "1", source: "vcard" });

    await deleteImportedContact(record.id);

    expect(await getImportedContact(record.id)).toBeUndefined();
    expect(await listImportedContacts()).toEqual([]);
  });
});
