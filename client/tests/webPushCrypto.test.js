// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { encryptWebPushPayload, decryptWebPushPayload, bytesToBase64Url } from "../js/webPushCrypto.js";

async function fakeSubscription() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    keyPair,
    keys: { p256dh: bytesToBase64Url(publicRaw), auth: bytesToBase64Url(authSecret) }
  };
}

describe("encryptWebPushPayload / decryptWebPushPayload (RFC 8291 aes128gcm)", () => {
  it("round-trips a plaintext string through encrypt then decrypt", async () => {
    const sub = await fakeSubscription();
    const payload = await encryptWebPushPayload(sub.keys, "hello from Spirit");

    const plaintext = await decryptWebPushPayload(sub.keyPair, sub.keys.auth, payload);
    expect(plaintext).toBe("hello from Spirit");
  });

  it("round-trips a JSON-shaped invite payload (room + token, the real use case)", async () => {
    const sub = await fakeSubscription();
    const invite = JSON.stringify({ room: "room-id-123", token: "invite-token-456" });
    const payload = await encryptWebPushPayload(sub.keys, invite);

    const plaintext = await decryptWebPushPayload(sub.keyPair, sub.keys.auth, payload);
    expect(JSON.parse(plaintext)).toEqual({ room: "room-id-123", token: "invite-token-456" });
  });

  it("round-trips an empty plaintext", async () => {
    const sub = await fakeSubscription();
    const payload = await encryptWebPushPayload(sub.keys, "");

    const plaintext = await decryptWebPushPayload(sub.keyPair, sub.keys.auth, payload);
    expect(plaintext).toBe("");
  });

  it("produces a different ciphertext (and salt/sender key) on every call, even for the same plaintext (fresh ephemeral key + random salt per message)", async () => {
    const sub = await fakeSubscription();
    const a = await encryptWebPushPayload(sub.keys, "same text");
    const b = await encryptWebPushPayload(sub.keys, "same text");

    expect(bytesToBase64Url(a)).not.toBe(bytesToBase64Url(b));
    // salt is the first 16 bytes of the header.
    expect(bytesToBase64Url(a.slice(0, 16))).not.toBe(bytesToBase64Url(b.slice(0, 16)));
  });

  it("header layout matches RFC 8188: salt(16) + recordSize(4, big-endian) + idLen(1) + keyId(idLen)", async () => {
    const sub = await fakeSubscription();
    const payload = await encryptWebPushPayload(sub.keys, "x");

    const recordSize = new DataView(payload.buffer, payload.byteOffset + 16, 4).getUint32(0, false);
    expect(recordSize).toBe(4096);
    const idLen = payload[20];
    expect(idLen).toBe(65); // uncompressed P-256 point: 0x04 || X(32) || Y(32)
    // The keyId (sender's ephemeral public key) must itself be a valid,
    // importable raw P-256 public key.
    const senderPublicRaw = payload.slice(21, 21 + idLen);
    await expect(
      crypto.subtle.importKey("raw", senderPublicRaw, { name: "ECDH", namedCurve: "P-256" }, true, [])
    ).resolves.toBeTruthy();
  });

  it("fails to decrypt with the wrong receiver keypair (proves the scheme is actually bound to the recipient's keys, not just any AES-GCM blob)", async () => {
    const sub = await fakeSubscription();
    const wrongReceiver = await fakeSubscription();
    const payload = await encryptWebPushPayload(sub.keys, "secret");

    await expect(decryptWebPushPayload(wrongReceiver.keyPair, sub.keys.auth, payload)).rejects.toThrow();
  });

  it("fails to decrypt with the wrong auth secret", async () => {
    const sub = await fakeSubscription();
    const otherSub = await fakeSubscription();
    const payload = await encryptWebPushPayload(sub.keys, "secret");

    await expect(decryptWebPushPayload(sub.keyPair, otherSub.keys.auth, payload)).rejects.toThrow();
  });
});
