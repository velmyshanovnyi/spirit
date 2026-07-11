import { bytesToBase64, base64ToBytes } from "./codec.js";

const SIGNING_ALGORITHM = { name: "ECDSA", hash: "SHA-256" };
const LIST_PAYLOAD_PREFIX = "spirit-proof-set-v1";

/**
 * Canonical byte string the identity key signs. UNLIKE deviceLinking.js's
 * ":"/"|"-joined deviceListPayload, this list's entries (url, label) are
 * free-form text controlled by the user -- a URL routinely contains ":",
 * so a naive delimiter join is NOT injective (exec review finding: two
 * structurally different proof lists could serialize to identical bytes,
 * letting one signature validate multiple different sets). JSON.stringify
 * of a fixed-shape array is injective instead: every string is
 * length-implied via its own escaping, so no byte sequence is ambiguous
 * between "end of this field" and "start of the next".
 */
function proofSetPayload(version, proofs, revoked) {
  const canonicalProofs = proofs.map((p) => [p.url, p.label, p.added_at]);
  const canonicalRevoked = revoked.map((r) => [r.url, r.revoked_at]);
  return new TextEncoder().encode(
    `${LIST_PAYLOAD_PREFIX}|${JSON.stringify([version, canonicalProofs, canonicalRevoked])}`
  );
}

/**
 * Signs the authoritative, versioned list of a profile's linked-identity
 * proofs (docs/identity-verification.md) -- the same monotonic-version
 * pattern as deviceLinking.js's device list, so a stale/replayed set can
 * never override a newer one a contact already holds.
 */
export async function signProofSet(identityPrivateKey, proofs, revoked, { version }) {
  const signature = await crypto.subtle.sign(
    SIGNING_ALGORITHM,
    identityPrivateKey,
    proofSetPayload(version, proofs, revoked)
  );
  return { version, proofs, revoked, signature: bytesToBase64(new Uint8Array(signature)) };
}

/**
 * Pure predicate over peer-controlled input: false for anything invalid,
 * never throws.
 */
export async function verifyProofSet(identityPublicKey, set) {
  if (
    !set ||
    typeof set.version !== "number" ||
    !Array.isArray(set.proofs) ||
    !Array.isArray(set.revoked) ||
    typeof set.signature !== "string" ||
    set.proofs.some((p) => !p || typeof p.url !== "string" || typeof p.label !== "string" || typeof p.added_at !== "number") ||
    set.revoked.some((r) => !r || typeof r.url !== "string" || typeof r.revoked_at !== "number")
  ) {
    return false;
  }

  try {
    return await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      identityPublicKey,
      base64ToBytes(set.signature),
      proofSetPayload(set.version, set.proofs, set.revoked)
    );
  } catch {
    return false;
  }
}

/**
 * Monotonic update rule a contact applies to its held set: adopt `incoming`
 * only if it verifies AND is strictly newer than `current`. `current` may
 * be null (first set ever seen).
 */
export async function acceptNewerProofSet(identityPublicKey, current, incoming) {
  if (!(await verifyProofSet(identityPublicKey, incoming))) return current;
  if (current !== null && current !== undefined && incoming.version <= current.version) return current;
  return incoming;
}

/**
 * Adds a newly-published proof to the own signed set (or starts a
 * version-1 set if none exists yet).
 */
export async function addProofToSet(identityPrivateKey, currentSet, newProofEntry) {
  const proofs = [...(currentSet ? currentSet.proofs : []), newProofEntry];
  const revoked = currentSet ? currentSet.revoked : [];
  const version = (currentSet ? currentSet.version : 0) + 1;
  return signProofSet(identityPrivateKey, proofs, revoked, { version });
}

/**
 * Revokes a proof by URL: moves it from `proofs` into `revoked` (with the
 * revocation time) even if the underlying publication still exists --
 * revocation is authoritative from the key owner's side regardless
 * (docs/identity-verification.md).
 */
export async function revokeProofFromSet(identityPrivateKey, currentSet, urlToRevoke, { now = Date.now() } = {}) {
  const proofs = currentSet.proofs.filter((p) => p.url !== urlToRevoke);
  const revoked = [...currentSet.revoked, { url: urlToRevoke, revoked_at: now }];
  return signProofSet(identityPrivateKey, proofs, revoked, { version: currentSet.version + 1 });
}
