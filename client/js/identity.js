export async function generateIdentityKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
}

export async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits", "deriveKey"]
  );
}

export async function exportPrivateKeyRaw(privateKey) {
  return crypto.subtle.exportKey("pkcs8", privateKey);
}

export async function importPrivateKeyRaw(rawKey, algorithm, extractable = false) {
  const usages = algorithm.name === "ECDSA" ? ["sign"] : ["deriveBits", "deriveKey"];
  return crypto.subtle.importKey("pkcs8", rawKey, algorithm, extractable, usages);
}

export async function fingerprint(publicKey) {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  const digest = await crypto.subtle.digest("SHA-256", spki);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
