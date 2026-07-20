import { get, put, remove, listKeys } from "./db.js";

/**
 * Pending-import registry (specs/phase2b/import.md, Section I2): a contact
 * parsed out of a Telegram/vCard/WhatsApp export file, held in a
 * "not yet verified" state until the user manually matches it to a real
 * Spirit contact. Deliberately a separate store from contacts.js -- that
 * store is keyed by `fingerprint`, which an imported record does not have
 * until (and unless) the user matches it. See docs/migration.md for why
 * matching is manual-only: automatic matching by name/identifier similarity
 * would be a deanonymization vector.
 *
 * Keyed by a randomly generated id (same entropy/format as groupId in
 * groups.js: 16 random bytes, hex-encoded).
 */
function randomImportedContactId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveImportedContact({ displayName, sourceIdentifier, source, now = Date.now() }) {
  const id = randomImportedContactId();
  const record = { id, displayName, sourceIdentifier, source, importedAt: now, matchedFingerprint: null };
  await put("importedContacts", id, record);
  return record;
}

export async function getImportedContact(id) {
  return get("importedContacts", id);
}

export async function listImportedContacts() {
  const keys = await listKeys("importedContacts");
  return Promise.all(keys.map((key) => get("importedContacts", key)));
}

/**
 * Sets the real Spirit contact fingerprint this pending import has been
 * manually matched to (never called automatically -- see module comment).
 * Same orphan-record guard as contacts.js/groups.js's update functions.
 */
export async function setMatchedFingerprint(id, fingerprint) {
  const existing = await get("importedContacts", id);
  if (!existing) {
    throw new Error(`Unknown imported contact: ${id}`);
  }
  await put("importedContacts", id, { ...existing, matchedFingerprint: fingerprint });
}

export async function deleteImportedContact(id) {
  await remove("importedContacts", id);
}
