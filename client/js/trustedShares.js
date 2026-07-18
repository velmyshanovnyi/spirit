import { get, put, listKeys, remove } from "./db.js";

// Section S2 (specs/phase5/social-recovery.md): shares of OTHER people's
// identity-key secret, held on THIS device because this profile was chosen
// as one of their trusted-recovery contacts. Deliberately a separate
// IndexedDB store from "contacts" (contacts.js) -- a trusted share is data
// FROM the owner, stored ON the holder's device, conceptually distinct from
// data ABOUT a contact. Thin wrapper mirroring contacts.js's style.
//
// Keyed by ownerFingerprint: at most one stored share per distinct owner.
// Re-announcing OVERWRITES the prior share for that owner rather than
// erroring or keeping both -- a fresh splitSecret() call produces a new
// (threshold, totalShares) polynomial set that is INCOMPATIBLE with shares
// from any earlier split (mixing x/y pairs from two different splits does
// not reconstruct anything, it just produces garbage bytes). The old share
// is therefore useless the moment a new one is announced, so keeping only
// the latest is correct, not merely convenient.

/**
 * Stores (or overwrites) the share this device holds for `share.ownerFingerprint`.
 */
export async function saveTrustedShare(share) {
  await put("trustedShares", share.ownerFingerprint, share);
}

export async function getTrustedShare(ownerFingerprint) {
  return get("trustedShares", ownerFingerprint);
}

/**
 * All shares this device currently holds on behalf of other people (UI:
 * "Ви зберігаєте частку відновлення для: ...").
 */
export async function listTrustedShares() {
  const keys = await listKeys("trustedShares");
  return Promise.all(keys.map((key) => get("trustedShares", key)));
}

/**
 * Removes the share held for `ownerFingerprint` (e.g. the owner revoked this
 * contact's trusted-recovery role). No-op if none is stored.
 */
export async function deleteTrustedShare(ownerFingerprint) {
  await remove("trustedShares", ownerFingerprint);
}
