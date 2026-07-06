import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { generateIdentityKeyPair, exportPrivateKeyRaw } from "../js/identity.js";
import {
  generateDeviceKeyPair,
  signDeviceCertificate,
  verifyDeviceCertificate,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant
} from "../js/deviceLinking.js";
import { hasStoredProfile, loadPermanentProfile } from "../js/profile.js";
import { get } from "../js/db.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

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

});

describe("device linking protocol (link request / grant / apply)", () => {
  async function linkedSetup() {
    const identity = await generateIdentityKeyPair();
    // createLinkGrant takes RAW identity bytes, not a CryptoKey: a loaded
    // profile's private key is deliberately non-extractable (Section 3), so
    // the linking flow re-derives the raw key from the vault via passphrase.
    const identityRaw = new Uint8Array(await exportPrivateKeyRaw(identity.privateKey));
    const device = await generateDeviceKeyPair();
    const request = await createLinkRequest(device.publicKey);
    return { identity, identityRaw, device, request };
  }

  it("createLinkRequest produces a JSON-serializable request carrying the device public key", async () => {
    const { device, request } = await linkedSetup();

    expect(request.type).toBe("device-link-request");
    expect(typeof request.devicePubkey).toBe("string");
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);

    // The wire form must be the device's actual SPKI.
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", device.publicKey));
    expect(request.devicePubkey).toBe(btoa(String.fromCharCode(...spki)));
  });

  it("createLinkGrant signs a certificate binding the requested device key and carries identity + contacts", async () => {
    const { identity, identityRaw, request } = await linkedSetup();
    const contacts = [{ key: "peer1", value: { name: "Alice" } }];

    const grant = await createLinkGrant(identityRaw, request, { contacts });

    expect(grant.type).toBe("device-link-grant");
    expect(typeof grant.identityPrivateKey).toBe("string");
    expect(grant.contacts).toEqual(contacts);
    expect(await verifyDeviceCertificate(identity.publicKey, grant.certificate)).toBe(true);
    expect(grant.certificate.devicePubkey).toBe(request.devicePubkey);
    expect(JSON.parse(JSON.stringify(grant))).toEqual(grant);
  });

  it("createLinkGrant rejects a malformed request or an unparseable device public key", async () => {
    const { identityRaw } = await linkedSetup();

    await expect(createLinkGrant(identityRaw, null, {})).rejects.toThrow(/link request/i);
    await expect(createLinkGrant(identityRaw, { type: "device-link-request" }, {})).rejects.toThrow(/link request/i);
    // Valid base64 but not a parseable SPKI key -- the Section 8 review deferred
    // rejecting garbage device keys to this consumer; prove it actually rejects.
    await expect(
      createLinkGrant(identityRaw, { type: "device-link-request", devicePubkey: "AAAA" }, {})
    ).rejects.toThrow();
  });

  it("applyLinkGrant persists the identity so the new device can load it, and restores contacts", async () => {
    const { identity, identityRaw, device, request } = await linkedSetup();
    const contacts = [{ key: "peer1", value: { name: "Alice" } }];
    const grant = await createLinkGrant(identityRaw, request, { contacts });
    const overTheWire = JSON.parse(JSON.stringify(grant));

    const result = await applyLinkGrant(overTheWire, "new device passphrase", { devicePublicKey: device.publicKey });

    // Same identity as the primary device: cross sign/verify.
    const message = new TextEncoder().encode("link-grant-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, result.identityKeyPair.privateKey, message);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, identity.publicKey, signature, message)).toBe(true);

    // Actually persisted: an independent load with the local passphrase works.
    const reloaded = await loadPermanentProfile("new device passphrase");
    const reloadedSig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, reloaded.privateKey, message);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, identity.publicKey, reloadedSig, message)).toBe(true);

    // Contacts snapshot restored into the local db.
    expect(await get("contacts", "peer1")).toEqual({ name: "Alice" });
    expect(result.certificate).toEqual(grant.certificate);
  });

  it("applyLinkGrant rejects a grant whose certificate is bound to a DIFFERENT device key, without persisting", async () => {
    const { identityRaw, request } = await linkedSetup();
    const otherDevice = await generateDeviceKeyPair();
    const grant = await createLinkGrant(identityRaw, request, { contacts: [] });

    await expect(
      applyLinkGrant(grant, "pass", { devicePublicKey: otherDevice.publicKey })
    ).rejects.toThrow(/device/i);
    expect(await hasStoredProfile()).toBe(false);
  });

  it("applyLinkGrant rejects a tampered certificate, without persisting anything", async () => {
    const { identityRaw, device, request } = await linkedSetup();
    const grant = await createLinkGrant(identityRaw, request, { contacts: [] });
    const tampered = { ...grant, certificate: { ...grant.certificate, expiresAt: grant.certificate.expiresAt + 1 } };

    await expect(applyLinkGrant(tampered, "pass", { devicePublicKey: device.publicKey })).rejects.toThrow(/certificate/i);
    expect(await hasStoredProfile()).toBe(false);
  });

  it("applyLinkGrant rejects malformed grants", async () => {
    const device = await generateDeviceKeyPair();
    await expect(applyLinkGrant(null, "pass", { devicePublicKey: device.publicKey })).rejects.toThrow(/link grant/i);
    await expect(applyLinkGrant({ type: "device-link-grant" }, "pass", { devicePublicKey: device.publicKey })).rejects.toThrow(/link grant/i);
  });
});

describe("verifyDeviceCertificate (malformed input)", () => {
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
