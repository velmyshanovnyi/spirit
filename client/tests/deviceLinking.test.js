import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { generateIdentityKeyPair, exportPrivateKeyRaw } from "../js/identity.js";
import {
  generateDeviceKeyPair,
  signDeviceCertificate,
  verifyDeviceCertificate,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant,
  signDeviceList,
  verifyDeviceList,
  revokeDevice,
  isDeviceCertificateAllowed,
  acceptNewerDeviceList,
  appendDeviceToList
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

describe("versioned device list: sign / verify / revoke / membership / monotonicity", () => {
  async function listSetup() {
    const identity = await generateIdentityKeyPair();
    const deviceA = await generateDeviceKeyPair();
    const deviceB = await generateDeviceKeyPair();
    const certA = await signDeviceCertificate(identity.privateKey, deviceA.publicKey);
    const certB = await signDeviceCertificate(identity.privateKey, deviceB.publicKey);
    const list = await signDeviceList(identity.privateKey, [certA, certB], { version: 1 });
    return { identity, certA, certB, list };
  }

  it("signDeviceList produces a verifiable, JSON-serializable versioned list", async () => {
    const { identity, certA, certB, list } = await listSetup();

    expect(list.version).toBe(1);
    expect(list.certificates).toEqual([certA, certB]);
    expect(typeof list.signature).toBe("string");
    expect(await verifyDeviceList(identity.publicKey, list)).toBe(true);
    expect(await verifyDeviceList(identity.publicKey, JSON.parse(JSON.stringify(list)))).toBe(true);
  });

  it("verifyDeviceList rejects tampering: bumped version, added/removed/swapped certificate, foreign identity", async () => {
    const { identity, certA, certB, list } = await listSetup();
    const foreign = await generateIdentityKeyPair();

    expect(await verifyDeviceList(identity.publicKey, { ...list, version: 2 })).toBe(false);
    expect(await verifyDeviceList(identity.publicKey, { ...list, certificates: [certA] })).toBe(false);
    expect(await verifyDeviceList(identity.publicKey, { ...list, certificates: [certB, certA] })).toBe(false);
    expect(await verifyDeviceList(foreign.publicKey, list)).toBe(false);
    expect(await verifyDeviceList(identity.publicKey, null)).toBe(false);
    expect(await verifyDeviceList(identity.publicKey, {})).toBe(false);
  });

  it("revokeDevice removes the certificate, increments the version, and the new list verifies", async () => {
    const { identity, certA, certB, list } = await listSetup();

    const updated = await revokeDevice(identity.privateKey, list, certB.devicePubkey);

    expect(updated.version).toBe(2);
    expect(updated.certificates).toEqual([certA]);
    expect(await verifyDeviceList(identity.publicKey, updated)).toBe(true);
  });

  it("revokeDevice removes ALL certificates bound to the revoked key (e.g. a re-issued one), not just the first", async () => {
    const identity = await generateIdentityKeyPair();
    const device = await generateDeviceKeyPair();
    const other = await generateDeviceKeyPair();
    // The same device key certified twice (re-issue: different validity window -> different signature).
    const certOld = await signDeviceCertificate(identity.privateKey, device.publicKey, { now: 1_000 });
    const certNew = await signDeviceCertificate(identity.privateKey, device.publicKey, { now: 2_000 });
    const certOther = await signDeviceCertificate(identity.privateKey, other.publicKey);
    expect(certOld.signature).not.toBe(certNew.signature);
    const list = await signDeviceList(identity.privateKey, [certOld, certNew, certOther], { version: 1 });

    const updated = await revokeDevice(identity.privateKey, list, certOld.devicePubkey);

    expect(updated.certificates).toEqual([certOther]);
    expect(isDeviceCertificateAllowed(updated, certOld)).toBe(false);
    expect(isDeviceCertificateAllowed(updated, certNew)).toBe(false);
  });

  it("a contact holding the updated list rejects the revoked certificate and still accepts the remaining one", async () => {
    const { identity, certA, certB, list } = await listSetup();
    const updated = await revokeDevice(identity.privateKey, list, certB.devicePubkey);

    // Before revocation both devices were allowed.
    expect(isDeviceCertificateAllowed(list, certA)).toBe(true);
    expect(isDeviceCertificateAllowed(list, certB)).toBe(true);
    // After: messages signed by the revoked device's certificate must be rejected.
    expect(isDeviceCertificateAllowed(updated, certA)).toBe(true);
    expect(isDeviceCertificateAllowed(updated, certB)).toBe(false);
  });

  it("acceptNewerDeviceList applies only a verified, strictly-newer list (replay of an older list is ignored)", async () => {
    const { identity, certB, list } = await listSetup();
    const updated = await revokeDevice(identity.privateKey, list, certB.devicePubkey);

    // Newer verified list wins.
    expect(await acceptNewerDeviceList(identity.publicKey, list, updated)).toEqual(updated);
    // Replaying the OLD list (attacker trying to resurrect the revoked device) is ignored.
    expect(await acceptNewerDeviceList(identity.publicKey, updated, list)).toEqual(updated);
    // Same version is not an update.
    expect(await acceptNewerDeviceList(identity.publicKey, updated, updated)).toEqual(updated);
  });

  it("acceptNewerDeviceList ignores a newer-version list with an invalid signature", async () => {
    const { identity, certA, certB, list } = await listSetup();
    const forged = { version: 99, certificates: [certA, certB], signature: list.signature };

    expect(await acceptNewerDeviceList(identity.publicKey, list, forged)).toEqual(list);
  });

  it("acceptNewerDeviceList accepts a first verified list when none is held yet", async () => {
    const { identity, list } = await listSetup();
    expect(await acceptNewerDeviceList(identity.publicKey, null, list)).toEqual(list);
  });

  it("appendDeviceToList starts a version-1 list from nothing and appends with version+1 (raw identity bytes)", async () => {
    const identity = await generateIdentityKeyPair();
    const identityRaw = new Uint8Array(await exportPrivateKeyRaw(identity.privateKey));
    const deviceA = await generateDeviceKeyPair();
    const deviceB = await generateDeviceKeyPair();
    const certA = await signDeviceCertificate(identity.privateKey, deviceA.publicKey);
    const certB = await signDeviceCertificate(identity.privateKey, deviceB.publicKey);

    const first = await appendDeviceToList(identityRaw, null, certA);
    expect(first.version).toBe(1);
    expect(first.certificates).toEqual([certA]);
    expect(await verifyDeviceList(identity.publicKey, first)).toBe(true);

    const second = await appendDeviceToList(identityRaw, first, certB);
    expect(second.version).toBe(2);
    expect(second.certificates).toEqual([certA, certB]);
    expect(await verifyDeviceList(identity.publicKey, second)).toBe(true);
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
