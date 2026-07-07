import { get, put } from "./db.js";

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
export async function rememberContact({ fingerprint, identityPubkeyWire, now = Date.now() }) {
  const existing = await get("contacts", fingerprint);
  if (existing) {
    return { status: "known", contact: existing };
  }
  const contact = { fingerprint, identityPubkeyWire, firstSeen: now, deviceList: null };
  await put("contacts", fingerprint, contact);
  return { status: "new", contact };
}

export async function getContact(fingerprint) {
  return get("contacts", fingerprint);
}
