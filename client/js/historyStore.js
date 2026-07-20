import { encryptForVault, decryptForVault } from "./vault.js";
import { put, get, listKeys } from "./db.js";

// Record keys must sort chronologically as STRINGS (IndexedDB key order),
// so the timestamp is zero-padded to a fixed width. 16 digits covers epoch
// milliseconds far beyond any realistic date.
const TIMESTAMP_PAD = 16;

function messageKey(profileId, contactId, timestamp) {
  const padded = String(timestamp).padStart(TIMESTAMP_PAD, "0");
  // Random suffix: two messages in the same millisecond must not overwrite
  // each other (put() upserts by key).
  const suffix = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // profileId namespaces histories of different OWN profiles (multi-account,
  // Section 15): each profile's rows are encrypted with its own vault key,
  // so without the namespace one profile's listMessages would throw on
  // another profile's (legitimately undecryptable) rows.
  return `${profileId}:${contactId}:${padded}:${suffix}`;
}

/**
 * Appends one chat message to the encrypted history (docs/accounts.md).
 * Everything about the message -- text, direction, exact timestamp -- lives
 * only inside the AES-GCM ciphertext; the record key leaks the contactId
 * and coarse ordering, which the db's existence already implies.
 * Ephemeral mode simply never calls this.
 */
export async function appendMessage(vaultKey, profileId, contactId, payload) {
  // The payload is serialized as-is (not re-assembled from just the
  // { direction, text, timestamp } fields) so extra fields ride along in
  // the same encrypted JSON without any storage-schema change -- e.g.
  // `imported: true` for Section I3 (specs/phase2b/import.md) history
  // messages.
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await encryptForVault(vaultKey, plaintext);
  await put("messages", messageKey(profileId, contactId, payload.timestamp), ciphertext);
}

/**
 * Returns the contact's messages decrypted, oldest first.
 *
 * @throws on a wrong vault key (AES-GCM auth failure) -- corrupted history
 *         must surface, not render as garbage.
 */
export async function listMessages(vaultKey, profileId, contactId) {
  const prefix = `${profileId}:${contactId}:`;
  const keys = (await listKeys("messages")).filter((key) => key.startsWith(prefix)).sort();

  const messages = [];
  for (const key of keys) {
    const ciphertext = await get("messages", key);
    const plaintext = await decryptForVault(vaultKey, ciphertext);
    messages.push(JSON.parse(new TextDecoder().decode(plaintext)));
  }
  return messages;
}

/**
 * One entry per contact this profile has history with (history screen,
 * Section N4): { contactId, messageCount, lastMessage }. Only the last
 * message per contact is decrypted -- listing a large history shouldn't
 * decrypt every row just to build a preview.
 */
export async function listConversations(vaultKey, profileId) {
  const prefix = `${profileId}:`;
  const keys = (await listKeys("messages")).filter((key) => key.startsWith(prefix)).sort();

  const keysByContact = new Map();
  for (const key of keys) {
    const contactId = key.slice(prefix.length, key.indexOf(":", prefix.length));
    if (!keysByContact.has(contactId)) keysByContact.set(contactId, []);
    keysByContact.get(contactId).push(key);
  }

  const conversations = [];
  for (const [contactId, contactKeys] of keysByContact) {
    const lastKey = contactKeys[contactKeys.length - 1]; // sorted -> chronologically last
    const ciphertext = await get("messages", lastKey);
    const plaintext = await decryptForVault(vaultKey, ciphertext);
    conversations.push({
      contactId,
      messageCount: contactKeys.length,
      lastMessage: JSON.parse(new TextDecoder().decode(plaintext))
    });
  }
  return conversations;
}
