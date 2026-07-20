import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { generateSalt, deriveVaultKey } from "../js/vault.js";
import { appendMessage, listMessages, listConversations } from "../js/historyStore.js";
import { get, listKeys } from "../js/db.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

async function freshVaultKey(passphrase = "history passphrase") {
  return deriveVaultKey(passphrase, generateSalt());
}

const PROFILE = "0".repeat(64); // own profile id (identity fingerprint)
const CONTACT_A = "a".repeat(64); // identity fingerprints are 64-char hex
const CONTACT_B = "b".repeat(64);

describe("appendMessage", () => {
  it("persists the message encrypted -- the plaintext never appears in the stored record or its key", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "цілком таємно", timestamp: 1000 });

    const keys = await listKeys("messages");
    expect(keys.length).toBe(1);
    const record = await get("messages", keys[0]);
    const storedFlat = JSON.stringify(record) + keys[0];
    expect(storedFlat).not.toContain("цілком таємно");
    expect(storedFlat).not.toContain("out");
  });

  it("passes extra payload fields (e.g. imported: true, Section I3) through to storage without a schema change", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, CONTACT_A, {
      direction: "in",
      text: "historical message",
      timestamp: 1000,
      imported: true
    });

    const messages = await listMessages(vaultKey, PROFILE, CONTACT_A);
    expect(messages).toEqual([{ direction: "in", text: "historical message", timestamp: 1000, imported: true }]);
  });
});

describe("listMessages", () => {
  it("returns a contact's messages decrypted, in chronological order, even when appended out of order", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "in", text: "third", timestamp: 3000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "first", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "in", text: "second", timestamp: 2000 });

    const messages = await listMessages(vaultKey, PROFILE, CONTACT_A);

    expect(messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
    expect(messages.map((m) => m.direction)).toEqual(["out", "in", "in"]);
    expect(messages.map((m) => m.timestamp)).toEqual([1000, 2000, 3000]);
  });

  it("orders correctly across timestamps of different digit lengths (lexicographic-key trap)", async () => {
    const vaultKey = await freshVaultKey();

    // "999" > "1000" lexicographically -- a naive string key would misorder these.
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "later", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "earlier", timestamp: 999 });

    const messages = await listMessages(vaultKey, PROFILE, CONTACT_A);
    expect(messages.map((m) => m.text)).toEqual(["earlier", "later"]);
  });

  it("does not mix messages between different contacts", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "for A", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_B, { direction: "out", text: "for B", timestamp: 1001 });

    expect((await listMessages(vaultKey, PROFILE, CONTACT_A)).map((m) => m.text)).toEqual(["for A"]);
    expect((await listMessages(vaultKey, PROFILE, CONTACT_B)).map((m) => m.text)).toEqual(["for B"]);
  });

  it("keeps two messages with the same timestamp for the same contact (no silent overwrite)", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "one", timestamp: 5000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "two", timestamp: 5000 });

    const messages = await listMessages(vaultKey, PROFILE, CONTACT_A);
    expect(messages.map((m) => m.text).sort()).toEqual(["one", "two"]);
  });

  it("throws on a wrong vault key instead of returning garbage", async () => {
    const rightKey = await freshVaultKey("right");
    const wrongKey = await freshVaultKey("wrong");

    await appendMessage(rightKey, PROFILE, CONTACT_A, { direction: "out", text: "secret", timestamp: 1000 });

    await expect(listMessages(wrongKey, PROFILE, CONTACT_A)).rejects.toThrow();
  });

  it("returns an empty array for a contact with no history", async () => {
    const vaultKey = await freshVaultKey();
    expect(await listMessages(vaultKey, PROFILE, CONTACT_A)).toEqual([]);
  });

  it("isolates histories of different OWN profiles for the same contact (multi-account)", async () => {
    const keyA = await freshVaultKey("profile A");
    const keyB = await freshVaultKey("profile B");
    const otherProfile = "1".repeat(64);

    await appendMessage(keyA, PROFILE, CONTACT_A, { direction: "out", text: "A's view", timestamp: 1000 });

    // Profile B sees nothing for the same contact -- and does NOT throw on
    // A's rows, which its vault key could never decrypt.
    expect(await listMessages(keyB, otherProfile, CONTACT_A)).toEqual([]);
  });
});

describe("listConversations", () => {
  it("returns an empty array when this profile has no history", async () => {
    const vaultKey = await freshVaultKey();
    expect(await listConversations(vaultKey, PROFILE)).toEqual([]);
  });

  it("returns one entry per contact, with the message count and the LAST message as preview", async () => {
    const vaultKey = await freshVaultKey();
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "hi", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "in", text: "hey", timestamp: 2000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_A, { direction: "out", text: "latest for A", timestamp: 3000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_B, { direction: "in", text: "only one for B", timestamp: 1500 });

    const conversations = await listConversations(vaultKey, PROFILE);

    expect(conversations.map((c) => c.contactId).sort()).toEqual([CONTACT_A, CONTACT_B].sort());
    const a = conversations.find((c) => c.contactId === CONTACT_A);
    expect(a.messageCount).toBe(3);
    expect(a.lastMessage).toEqual({ direction: "out", text: "latest for A", timestamp: 3000 });
    const b = conversations.find((c) => c.contactId === CONTACT_B);
    expect(b.messageCount).toBe(1);
    expect(b.lastMessage).toEqual({ direction: "in", text: "only one for B", timestamp: 1500 });
  });

  it("does not mix conversations of different OWN profiles (multi-account)", async () => {
    const keyA = await freshVaultKey("profile A");
    const keyB = await freshVaultKey("profile B");
    const otherProfile = "1".repeat(64);

    await appendMessage(keyA, PROFILE, CONTACT_A, { direction: "out", text: "A's conversation", timestamp: 1000 });

    // Profile B's own (empty) history must not throw on A's undecryptable rows.
    expect(await listConversations(keyB, otherProfile)).toEqual([]);
  });
});

describe("group namespace (Section GC1 -- contactId is 'any string key', groups just reuse it)", () => {
  // A groupId happens to look exactly like a contact fingerprint here on
  // purpose: the namespace mechanism must not rely on format to tell them
  // apart -- appendMessage/listMessages treat contactId as an opaque key.
  const GROUP_ID = CONTACT_A;

  it("keeps a group's history in listMessages, addressed by groupId like a contactId", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, GROUP_ID, { direction: "out", text: "group hi", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, GROUP_ID, { direction: "in", text: "group hey", timestamp: 2000 });

    const messages = await listMessages(vaultKey, PROFILE, GROUP_ID);
    expect(messages.map((m) => m.text)).toEqual(["group hi", "group hey"]);
  });

  it("does not mix a group's messages with a 1:1 contact's messages even when the keys share the same string format", async () => {
    const vaultKey = await freshVaultKey();
    const REAL_CONTACT = CONTACT_B; // distinct string -- the actual collision case is covered below

    await appendMessage(vaultKey, PROFILE, GROUP_ID, { direction: "out", text: "for the group", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, REAL_CONTACT, { direction: "out", text: "for the 1:1 contact", timestamp: 1000 });

    expect((await listMessages(vaultKey, PROFILE, GROUP_ID)).map((m) => m.text)).toEqual(["for the group"]);
    expect((await listMessages(vaultKey, PROFILE, REAL_CONTACT)).map((m) => m.text)).toEqual(["for the 1:1 contact"]);
  });

  it("lists a group as its own conversation entry in listConversations, alongside 1:1 contacts", async () => {
    const vaultKey = await freshVaultKey();

    await appendMessage(vaultKey, PROFILE, GROUP_ID, { direction: "out", text: "group msg 1", timestamp: 1000 });
    await appendMessage(vaultKey, PROFILE, GROUP_ID, { direction: "in", text: "group msg 2", timestamp: 2000 });
    await appendMessage(vaultKey, PROFILE, CONTACT_B, { direction: "out", text: "1:1 msg", timestamp: 1500 });

    const conversations = await listConversations(vaultKey, PROFILE);

    expect(conversations.map((c) => c.contactId).sort()).toEqual([GROUP_ID, CONTACT_B].sort());
    const group = conversations.find((c) => c.contactId === GROUP_ID);
    expect(group.messageCount).toBe(2);
    expect(group.lastMessage).toEqual({ direction: "in", text: "group msg 2", timestamp: 2000 });
  });
});
