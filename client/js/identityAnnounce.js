import { bytesToBase64, base64ToBytes } from "./codec.js";
import { fingerprint } from "./identity.js";

const SIGNING_ALGORITHM = { name: "ECDSA", hash: "SHA-256" };
const IDENTITY_KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

// Domain-separation prefix, same convention as deviceLinking.js payloads.
const ANNOUNCE_PAYLOAD_PREFIX = "spirit-identity-announce-v1";

/**
 * The signed payload binds the announced identity key to THIS session's
 * pair of ECDH wire keys (sender's own first, receiver's second), so an
 * announce captured in one session cannot be replayed into another -- a
 * MITM signaling node that terminates two separate ECDH handshakes has
 * different wire keys on each leg and can relay neither side's announce.
 * "|" is absent from base64, so the encoding is injective.
 */
function announcePayload(identityPubkeyWire, senderEcdhWire, receiverEcdhWire, nickname) {
  return new TextEncoder().encode(
    `${ANNOUNCE_PAYLOAD_PREFIX}|${identityPubkeyWire}|${senderEcdhWire}|${receiverEcdhWire}|${nickname}`
  );
}

/**
 * First control message of a chat session (docs/e2ee.md, TOFU): announces
 * and PROVES this side's identity -- the signature demonstrates possession
 * of the private key matching the announced public key, bound to this
 * session. `localEcdhWire` is the announcer's own session ECDH public key
 * (wire form), `peerEcdhWire` the other side's.
 */
export async function createIdentityAnnounce(identityPrivateKey, identityPublicKey, localEcdhWire, peerEcdhWire, nickname = "") {
  const spki = await crypto.subtle.exportKey("spki", identityPublicKey);
  const identityPubkey = bytesToBase64(new Uint8Array(spki));
  const signature = await crypto.subtle.sign(
    SIGNING_ALGORITHM,
    identityPrivateKey,
    announcePayload(identityPubkey, localEcdhWire, peerEcdhWire, nickname)
  );
  return { type: "identity-announce", identityPubkey, nickname, signature: bytesToBase64(new Uint8Array(signature)) };
}

/**
 * Verifies a received announce. `localEcdhWire`/`peerEcdhWire` are the
 * VERIFIER's own view of the session -- the mirroring (the announcer's
 * "local" is our "peer") happens here, so both sides just pass their own
 * perspective. Verification against the key contained in the announce
 * itself is intentional: it proves possession + session binding, which is
 * exactly the TOFU trust anchor (continuity is the caller's job via
 * contacts.js).
 *
 * @returns {null} for anything invalid (never throws -- peer-controlled input),
 *          or { identityPublicKey, identityPubkeyWire, fingerprint }.
 */
export async function verifyIdentityAnnounce(announce, localEcdhWire, peerEcdhWire) {
  if (
    !announce ||
    announce.type !== "identity-announce" ||
    typeof announce.identityPubkey !== "string" ||
    typeof announce.signature !== "string" ||
    (announce.nickname !== undefined && typeof announce.nickname !== "string")
  ) {
    return null;
  }
  const nickname = announce.nickname ?? "";

  try {
    const identityPublicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(announce.identityPubkey),
      IDENTITY_KEY_ALGORITHM,
      true,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      identityPublicKey,
      base64ToBytes(announce.signature),
      // Announcer's (sender, receiver) == our (peer, local).
      announcePayload(announce.identityPubkey, peerEcdhWire, localEcdhWire, nickname)
    );
    if (!valid) return null;

    return {
      identityPublicKey,
      identityPubkeyWire: announce.identityPubkey,
      fingerprint: await fingerprint(identityPublicKey),
      nickname
    };
  } catch {
    return null;
  }
}
