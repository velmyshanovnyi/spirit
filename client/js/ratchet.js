import { base64ToBytes } from "./codec.js";

const ROOT_HKDF_INFO = new TextEncoder().encode("spirit-ratchet-root-v1");
const CHAIN_HKDF_INFO = new TextEncoder().encode("spirit-ratchet-chain-v1");
const MESSAGE_KEY_INFO = new TextEncoder().encode("spirit-ratchet-msgkey-v1");
const NEXT_CHAIN_INFO = new TextEncoder().encode("spirit-ratchet-nextchain-v1");
const HKDF_SALT = new Uint8Array(0);

async function importHkdfKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveBits"]);
}

async function hkdfBits(keyMaterial, info, length = 256) {
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info },
    keyMaterial,
    length
  );
  return new Uint8Array(bits);
}

export async function deriveRootKey(privateKey, publicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );

  const keyMaterial = await importHkdfKey(sharedBits);
  return hkdfBits(keyMaterial, ROOT_HKDF_INFO);
}

export async function deriveInitialChainKeys(rootKeyBytes, localWire, peerWire) {
  const keyMaterial = await importHkdfKey(rootKeyBytes);
  const [firstWire, secondWire] = [localWire, peerWire].sort();
  const firstChain = await hkdfBits(
    keyMaterial,
    new Uint8Array([...CHAIN_HKDF_INFO, ...base64ToBytes(firstWire)])
  );
  const secondChain = await hkdfBits(
    keyMaterial,
    new Uint8Array([...CHAIN_HKDF_INFO, ...base64ToBytes(secondWire)])
  );

  const isLocalFirst = localWire === firstWire;
  return {
    sendChainKey: isLocalFirst ? firstChain : secondChain,
    receiveChainKey: isLocalFirst ? secondChain : firstChain,
  };
}

export async function ratchetStep(chainKeyBytes) {
  const keyMaterial = await importHkdfKey(chainKeyBytes);

  const messageKeyBits = await hkdfBits(keyMaterial, MESSAGE_KEY_INFO);
  const messageKey = await crypto.subtle.importKey(
    "raw",
    messageKeyBits,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const nextChainKeyBytes = await hkdfBits(keyMaterial, NEXT_CHAIN_INFO);

  return { messageKey, nextChainKeyBytes };
}
