import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { generateSalt, deriveVaultKey } from "../js/vault.js";
import { appendMessage, listMessages } from "../js/historyStore.js";
import { get, listKeys } from "../js/db.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

async function freshVaultKey(passphrase = "history passphrase") {
  return deriveVaultKey(passphrase, generateSalt());
}

const CONTACT_A = "a".repeat(64); // identity fingerprints are 64-char hex
const CONTACT_B = "b".repeat(64);

describe("appendMessage", () => {
  it("persists the message encrypted -- the plaintext never appears in the stored record or its key", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "цілком таємно", timestamp: 1000 });

    const keys = await listKeys("messages");
    expect(keys.length).toBe(1);
    const record = await get("messages", keys[0]);
    const storedFlat = JSON.stringify(record) + keys[0];
    expect(storedFlat).not.toContain("цілком таємно");
    expect(storedFlat).not.toContain("out");
  });
});

describe("listMessages", () => {
  it("returns a contact's messages decrypted, in chronological order, even when appended out of order", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, CONTACT_A, { direction: "in", text: "third", timestamp: 3000 });
    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "first", timestamp: 1000 });
    await appendMessage(vaultKey, CONTACT_A, { direction: "in", text: "second", timestamp: 2000 });

    const messages = await listMessages(vaultKey, CONTACT_A);

    expect(messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
    expect(messages.map((m) => m.direction)).toEqual(["out", "in", "in"]);
    expect(messages.map((m) => m.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it("orders correctly across timestamps of different digit lengths (lexicographic-key trap)", async () => {
    const vaultKey = await freshVaultKey();

    // "999" > "1000" lexicographically -- a naive string key would misorder these.
    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "later", timestamp: 1000 });
    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "earlier", timestamp: 999 });

    const messages = await listMessages(vaultKey, CONTACT_A);
    expect(messages.map((m) => m.text)).toEqual(["earlier", "later"]);
  });

  it("does not mix messages between different contacts", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "for A", timestamp: 1000 });
    await appendMessage(vaultKey, CONTACT_B, { direction: "out", text: "for B", timestamp: 1001 });

    expect((await listMessages(vaultKey, CONTACT_A)).map((m) => m.text)).toEqual(["for A"]);
    expect((await listMessages(vaultKey, CONTACT_B)).map((m) => m.text)).toEqual(["for B"]);
  });

  it("keeps two messages with the same timestamp for the same contact (no silent overwrite)", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "one", timestamp: 5000 });
    await appendMessage(vaultKey, CONTACT_A, { direction: "out", text: "two", timestamp: 5000 });

    const messages = await listMessages(vaultKey, CONTACT_A);
    expect(messages.map((m) => m.text).sort()).toEqual(["one", "two"]);
  });

  it("throws on a wrong vault key instead of returning garbage", async () => {
    const rightKey = await freshVaultKey("right");
    const wrongKey = await freshVaultKey("wrong");

    await appendMessage(rightKey, CONTACT_A, { direction: "out", text: "secret", timestamp: 1000 });

    await expect(listMessages(wrongKey, CONTACT_A)).rejects.toThrow();
  });

  it("returns an empty array for a contact with no history", async () => {
    const vaultKey = await freshVaultKey();
    expect(await listMessages(vaultKey, CONTACT_A)).toEqual([]);
  });
});
