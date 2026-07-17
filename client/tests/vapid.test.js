// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { signVapidJwt } from "../js/vapid.js";
import { VAPID_PRIVATE_KEY_JWK, VAPID_PUBLIC_KEY_JWK } from "../js/vapidKeys.js";

function base64UrlToBytes(base64url) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function importPrivateKey() {
  return crypto.subtle.importKey("jwk", VAPID_PRIVATE_KEY_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign"
  ]);
}

async function importPublicKey() {
  return crypto.subtle.importKey("jwk", VAPID_PUBLIC_KEY_JWK, { name: "ECDSA", namedCurve: "P-256" }, true, [
    "verify"
  ]);
}

describe("signVapidJwt (RFC 8292)", () => {
  it("returns a three-part JWT (header.payload.signature) with the correct header and payload shape", async () => {
    const privateKey = await importPrivateKey();
    const jwt = await signVapidJwt(privateKey, "https://fcm.googleapis.com", "mailto:spirit@example.invalid");

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    expect(header).toEqual({ typ: "JWT", alg: "ES256" });

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:spirit@example.invalid");
    expect(typeof payload.exp).toBe("number");
  });

  it("produces a signature that verifies against the matching public key", async () => {
    const privateKey = await importPrivateKey();
    const publicKey = await importPublicKey();
    const jwt = await signVapidJwt(privateKey, "https://fcm.googleapis.com", "mailto:spirit@example.invalid");

    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlToBytes(signatureB64);

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signatureBytes,
      signingInput
    );
    expect(valid).toBe(true);
  });

  it("fails verification against a DIFFERENT public key (proves the signature is actually bound to the content)", async () => {
    const privateKey = await importPrivateKey();
    const otherKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify"
    ]);
    const jwt = await signVapidJwt(privateKey, "https://fcm.googleapis.com", "mailto:spirit@example.invalid");

    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlToBytes(signatureB64);

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      otherKeyPair.publicKey,
      signatureBytes,
      signingInput
    );
    expect(valid).toBe(false);
  });

  it("sets exp to no more than 24 hours from now (VAPID spec limit)", async () => {
    const privateKey = await importPrivateKey();
    const before = Math.floor(Date.now() / 1000);
    const jwt = await signVapidJwt(privateKey, "https://fcm.googleapis.com", "mailto:spirit@example.invalid");
    const after = Math.floor(Date.now() / 1000);

    const parts = jwt.split(".");
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));

    expect(payload.exp).toBeGreaterThan(before);
    expect(payload.exp).toBeLessThanOrEqual(after + 24 * 3600);
  });

  it("respects an explicit ttlSeconds override, still capped at 24 hours", async () => {
    const privateKey = await importPrivateKey();
    const now = Date.now();
    const jwt = await signVapidJwt(privateKey, "https://fcm.googleapis.com", "mailto:spirit@example.invalid", {
      now,
      ttlSeconds: 3600
    });

    const parts = jwt.split(".");
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
    expect(payload.exp).toBe(Math.floor(now / 1000) + 3600);
  });
});
