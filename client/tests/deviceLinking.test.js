import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair } from "../js/identity.js";
import {
  generateDeviceKeyPair,
  signDeviceCertificate,
  verifyDeviceCertificate
} from "../js/deviceLinking.js";

describe("generateDeviceKeyPair", () => {
  it("generates a separate ECDSA P-256 sign/verify key pair, independent of the identity key", async () => {
    const device = await generateDeviceKeyPair();

    expect(device.privateKey.algorithm.name).toBe("ECDSA");
    expect(device.privateKey.algorithm.namedCurve).toBe("P-256");
    expect(device.privateKey.usages).toContain("sign");
    expect(device.publicKey.usages).toContain("verify");

    // Two calls must produce genuinely different keys.
    const another = await generateDeviceKeyPair();
    const spkiA = new Uint8Array(await crypto.subtle.exportKey("spki", device.publicKey));
    const spkiB = new Uint8Array(await crypto.subtle.exportKey("spki", another.publicKey));
    expect(spkiA).not.toEqual(spkiB);
  });
});

describe("signDeviceCertificate / verifyDeviceCertificate", () => {
  it("produces a certificate that verifies against the signing identity's public key", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();

    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey);

    expect(typeof cert.devicePubkey).toBe("string");
    expect(typeof cert.issuedAt).toBe("number");
    expect(typeof cert.expiresAt).toBe("number");
    expect(cert.expiresAt).toBeGreaterThan(cert.issuedAt);
    expect(typeof cert.signature).toBe("string");

    expect(await verifyDeviceCertificate(identity.publicKey, cert)).toBe(true);
  });

  it("survives a real JSON.stringify/parse round-trip (certificates travel over the wire)", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey);

    const reparsed = JSON.parse(JSON.stringify(cert));

    expect(await verifyDeviceCertificate(identity.publicKey, reparsed)).toBe(true);
  });

  it("rejects a certificate whose device public key was swapped for another (forged binding)", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const attacker = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey);

    const attackerSpki = new Uint8Array(await crypto.subtle.exportKey("spki", attacker.publicKey));
    const forged = {
      ...cert,
      devicePubkey: btoa(String.fromCharCode(...attackerSpki))
    };

    expect(await verifyDeviceCertificate(identity.publicKey, forged)).toBe(false);
  });

  it("rejects a certificate whose timestamps were tampered with after signing", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey);

    expect(await verifyDeviceCertificate(identity.publicKey, { ...cert, expiresAt: cert.expiresAt + 1 })).toBe(false);
    expect(await verifyDeviceCertificate(identity.publicKey, { ...cert, issuedAt: cert.issuedAt - 1 })).toBe(false);
  });

  it("rejects an expired certificate even though its signature is genuine", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey, { validityMs: 1000 });

    // Genuine signature, but past its expiry.
    expect(await verifyDeviceCertificate(identity.publicKey, cert, { now: cert.expiresAt + 1 })).toBe(false);
    // And still valid just before expiry -- proves the rejection above is expiry, not the signature.
    expect(await verifyDeviceCertificate(identity.publicKey, cert, { now: cert.expiresAt - 1 })).toBe(true);
  });

  it("rejects a certificate not yet valid (issuedAt in the future, e.g. forged clock)", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identity.privateKey, device.publicKey);

    expect(await verifyDeviceCertificate(identity.publicKey, cert, { now: cert.issuedAt - 60_001 })).toBe(false);
  });

  it("rejects a certificate signed by a different identity", async () => {
    const identityA = await generateIdentityKeyPair();
    const identityB = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const cert = await signDeviceCertificate(identityA.privateKey, device.publicKey);

    expect(await verifyDeviceCertificate(identityB.publicKey, cert)).toBe(false);
  });

  it("rejects malformed certificates (missing fields, wrong types) as invalid, never throws", async () => {
    const identity = await generateIdentityKeyPair();

    expect(await verifyDeviceCertificate(identity.publicKey, null)).toBe(false);
    expect(await verifyDeviceCertificate(identity.publicKey, {})).toBe(false);
    expect(
      await verifyDeviceCertificate(identity.publicKey, {
        devicePubkey: "!!!not-base64!!!",
        issuedAt: 1,
        expiresAt: 2,
        signature: "AAAA"
      })
    ).toBe(false);
  });
});
