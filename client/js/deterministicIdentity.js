import { argon2id } from "./vendor/hash-wasm.esm.js";

// Section H1 (specs/phase3/deterministic-accounts.md): portable, cross-node
// accounts. identity = Argon2id(password, salt=name) -- any independent
// Spirit node can recompute the same material from just (login, password),
// no local storage required.
//
// Parameters chosen for ~0.5-1.5s on a mobile browser via WASM, while being
// memory-hard enough that GPU/ASIC-farm parallelization is 2-3 orders of
// magnitude more expensive per guess than for PBKDF2/SHA (VRAM-bound, not
// compute-bound) -- see the spec for the full threat-model writeup.
const ARGON2ID_ITERATIONS = 3;
const ARGON2ID_MEMORY_SIZE_KIB = 131072; // 128 MiB
const ARGON2ID_PARALLELISM = 1;
// Exec review: this 64-byte split is safe ONLY because Argon2's H' tag
// function is a single Blake2b-512 call for hashLength <= 64 -- the two
// halves are independent segments of one hash, not separately derivable.
// Raising this past 64 switches Argon2 into chained-block mode for longer
// outputs, which changes that invariant -- don't, without re-reviewing.
const OUTPUT_LENGTH_BYTES = 64; // split into two independent 32-byte segments below

const KEY_SCALAR_BYTES = 32;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Derives the two pieces of a portable account's identity from a single
 * Argon2id call: bytes 0-31 become the ECDSA private key scalar (same
 * import path as mnemonic.js's backup restore), bytes 32-63 become the
 * public login verifier tail. These are DELIBERATELY disjoint byte ranges
 * of one continuous KDF output stream -- the tail is never derivable from
 * (nor reveals) the key scalar, so publishing the login string never
 * exposes the private key.
 */
export async function deriveAccountMaterial(name, password) {
  const output = await argon2id({
    password,
    salt: name,
    iterations: ARGON2ID_ITERATIONS,
    memorySize: ARGON2ID_MEMORY_SIZE_KIB,
    parallelism: ARGON2ID_PARALLELISM,
    hashLength: OUTPUT_LENGTH_BYTES,
    outputType: "binary"
  });

  // Exec review: raw KDF output isn't range-checked against the P-256
  // curve order -- a ~2^-32 chance (name, password) yields an out-of-range
  // scalar, which crypto.subtle.importKey (identity.js) rejects. That's a
  // permanent dead end for that exact pair (unlike a random keypair, no
  // "just retry"). Same class of edge case already accepted for
  // mnemonic.js's restore path; consciously accepted here too rather than
  // silently -- not worth a reduce-and-retry loop for this probability.
  const privateKeyScalar = output.slice(0, KEY_SCALAR_BYTES);
  const tailBytes = output.slice(KEY_SCALAR_BYTES);
  const verifierTail = toBase64Url(tailBytes).slice(0, 16);

  return { privateKeyScalar, verifierTail };
}
