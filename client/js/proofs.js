import { bytesToBase64, base64ToBytes } from "./codec.js";

const SIGNING_ALGORITHM = { name: "ECDSA", hash: "SHA-256" };
const IDENTITY_KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };
const PROOF_VERSION = 1;
const BEGIN_MARKER = "-----BEGIN SPIRIT PROOF-----";
const END_MARKER = "-----END SPIRIT PROOF-----";
const FIELD_NAMES = ["version", "identity", "statement", "timestamp", "nonce"];

// Domain-separation prefix, same convention as identityAnnounce.js/
// deviceLinking.js payloads. "|" is absent from base64/hex/decimal, so the
// encoding is injective.
const PROOF_PAYLOAD_PREFIX = "spirit-proof-v1";

function proofPayload(version, identityWire, statement, timestamp, nonce) {
  return new TextEncoder().encode(`${PROOF_PAYLOAD_PREFIX}|${version}|${identityWire}|${statement}|${timestamp}|${nonce}`);
}

/**
 * Generates a self-contained, publishable text block (docs/identity-verification.md):
 * the user pastes this wherever they can post publicly-readable content
 * (site, gist, social post) as proof they control both that publication AND
 * this Spirit identity.
 */
export async function createProofBlock(identityPrivateKey, identityPublicKey, fingerprintDisplay, { now = Date.now(), nonce } = {}) {
  const spki = await crypto.subtle.exportKey("spki", identityPublicKey);
  const identityWire = bytesToBase64(new Uint8Array(spki));
  const statement = `I control this account and my Spirit identity fingerprint is ${fingerprintDisplay}`;
  const timestamp = Math.floor(now / 1000);
  const nonceHex = nonce ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

  const signature = await crypto.subtle.sign(
    SIGNING_ALGORITHM,
    identityPrivateKey,
    proofPayload(PROOF_VERSION, identityWire, statement, timestamp, nonceHex)
  );

  return [
    BEGIN_MARKER,
    `version: ${PROOF_VERSION}`,
    `identity: ${identityWire}`,
    `statement: ${statement}`,
    `timestamp: ${timestamp}`,
    `nonce: ${nonceHex}`,
    `signature: ${bytesToBase64(new Uint8Array(signature))}`,
    END_MARKER
  ].join("\n");
}

/**
 * Extracts and parses a proof block from arbitrary surrounding text (a
 * real post/page has other content around it) -- returns null if no
 * complete block with every required field is found, never throws.
 */
export function parseProofBlock(text) {
  if (typeof text !== "string") return null;
  const begin = text.indexOf(BEGIN_MARKER);
  const end = text.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) return null;

  const body = text.slice(begin + BEGIN_MARKER.length, end);
  const fields = {};
  for (const line of body.split("\n")) {
    const match = /^([a-z]+):\s*(.*)$/.exec(line.trim());
    if (match) fields[match[1]] = match[2];
  }
  for (const name of [...FIELD_NAMES, "signature"]) {
    if (typeof fields[name] !== "string" || fields[name] === "") return null;
  }
  const version = Number(fields.version);
  const timestamp = Number(fields.timestamp);
  if (!Number.isFinite(version) || !Number.isFinite(timestamp)) return null;

  return {
    version,
    identity: fields.identity,
    statement: fields.statement,
    timestamp,
    nonce: fields.nonce,
    signature: fields.signature
  };
}

/**
 * Verifies a parsed proof block against the EXPECTED contact's identity
 * (their already-known identityPubkeyWire, e.g. from contacts.js) -- both
 * the identity field must match that contact AND the signature must be
 * valid for the key embedded in the block itself. Never throws: the page
 * content is attacker/platform-controlled input.
 */
export async function verifyProofBlock(parsedBlock, expectedIdentityPubkeyWire) {
  if (!parsedBlock || parsedBlock.identity !== expectedIdentityPubkeyWire) return false;

  try {
    const identityPublicKey = await crypto.subtle.importKey(
      "spki",
      base64ToBytes(parsedBlock.identity),
      IDENTITY_KEY_ALGORITHM,
      true,
      ["verify"]
    );
    return await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      identityPublicKey,
      base64ToBytes(parsedBlock.signature),
      proofPayload(parsedBlock.version, parsedBlock.identity, parsedBlock.statement, parsedBlock.timestamp, parsedBlock.nonce)
    );
  } catch {
    return false;
  }
}
