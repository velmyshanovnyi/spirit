import { get, put, listKeys } from "./db.js";

/**
 * TOFU contact registry (docs/accounts.md): a contact is keyed by its
 * identity fingerprint. Only called in permanent-profile mode -- ephemeral
 * sessions persist nothing by design (app.js gates this).
 *
 * Returns { status: "new" | "known", contact }. Re-meeting a known contact
 * is NOT a re-registration: the original record (notably firstSeen) is kept.
 * `deviceList` starts null and is maintained by the device-list transport
 * (Section 13).
 */
export async function rememberContact({ fingerprint, identityPubkeyWire, nickname = null, now = Date.now() }) {
  const existing = await get("contacts", fingerprint);
  if (existing) {
    // Nicknames can change (unlike fingerprint/firstSeen) -- keep the latest
    // one the peer announced, but never clobber a known one with a blank.
    if (nickname && nickname !== existing.nickname) {
      const updated = { ...existing, nickname };
      await put("contacts", fingerprint, updated);
      return { status: "known", contact: updated };
    }
    return { status: "known", contact: existing };
  }
  const contact = { fingerprint, identityPubkeyWire, firstSeen: now, deviceList: null, nickname, proofSet: null };
  await put("contacts", fingerprint, contact);
  return { status: "new", contact };
}

export async function getContact(fingerprint) {
  return get("contacts", fingerprint);
}

/**
 * All TOFU-registered contacts (contacts screen, Section N3). The store is
 * currently global across profiles on this device (a known, tracked latent
 * gap -- see specs/reviews/phase2-section-15-multiaccounts-iter1.md).
 */
export async function listContacts() {
  const keys = await listKeys("contacts");
  return Promise.all(keys.map((key) => get("contacts", key)));
}

/**
 * Replaces the contact's held device list (already validated by the caller
 * via acceptNewerDeviceList -- this is pure storage). Refuses to create an
 * orphan record: a device list only makes sense for a TOFU-registered contact.
 */
export async function updateContactDeviceList(fingerprint, deviceList) {
  const existing = await get("contacts", fingerprint);
  if (!existing) {
    throw new Error(`Unknown contact: ${fingerprint}`);
  }
  await put("contacts", fingerprint, { ...existing, deviceList });
}

/**
 * Replaces the contact's held proof set (already validated by the caller
 * via acceptNewerProofSet -- this is pure storage). Same orphan-record
 * guard as updateContactDeviceList.
 */
export async function updateContactProofSet(fingerprint, proofSet) {
  const existing = await get("contacts", fingerprint);
  if (!existing) {
    throw new Error(`Unknown contact: ${fingerprint}`);
  }
  await put("contacts", fingerprint, { ...existing, proofSet });
}
