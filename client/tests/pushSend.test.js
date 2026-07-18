// @vitest-environment jsdom
// Section PN5 (specs/phase5/push-notifications.md): sending an encrypted
// invite payload directly to a contact's push subscription. Fails soft --
// see pushSend.js's own doc comment for the rationale (mode:"cors", not
// "no-cors": Web Push needs Authorization/Content-Encoding headers that
// aren't CORS-safelisted, so "no-cors" cannot carry them at all).
import { describe, it, expect, vi } from "vitest";
import { vapidAudienceFromEndpoint, buildPushRequestInit, sendPushNotification } from "../js/pushSend.js";
import { decryptWebPushPayload } from "../js/webPushCrypto.js";

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function makeReceiverSubscriptionKeys() {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    keyPair,
    subscriptionKeys: { p256dh: bytesToBase64Url(rawPublic), auth: bytesToBase64Url(authSecret) }
  };
}

describe("vapidAudienceFromEndpoint", () => {
  it("returns just the origin for an FCM-shaped endpoint", () => {
    expect(vapidAudienceFromEndpoint("https://fcm.googleapis.com/fcm/send/abc123?xyz")).toBe(
      "https://fcm.googleapis.com"
    );
  });

  it("returns just the origin for a Mozilla-shaped endpoint", () => {
    expect(vapidAudienceFromEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")).toBe(
      "https://updates.push.services.mozilla.com"
    );
  });
});

describe("buildPushRequestInit", () => {
  it("produces the exact header set, method, and body Web Push requires", () => {
    const body = new Uint8Array([1, 2, 3]);
    const init = buildPushRequestInit(body, "header.payload.sig", "PUBKEYRAW");

    expect(init.method).toBe("POST");
    expect(init.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["TTL"]).toBe("86400");
    expect(init.headers["Authorization"]).toMatch(/^vapid t=\S+, k=\S+$/);
    expect(init.headers["Authorization"]).toBe("vapid t=header.payload.sig, k=PUBKEYRAW");
    expect(init.body).toBe(body);
    expect(init.mode).toBeUndefined(); // default (cors), NOT "no-cors" -- see file header comment
  });
});

describe("sendPushNotification", () => {
  it("calls fetchImpl with the subscription endpoint and a spec-shaped init, and returns true on success", async () => {
    const { keyPair, subscriptionKeys } = await makeReceiverSubscriptionKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: subscriptionKeys };
    const invitePayload = { room: "room1", token: "tok1" };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    const result = await sendPushNotification(subscription, invitePayload, { fetchImpl });

    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(subscription.endpoint);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["TTL"]).toBe("86400");
    expect(init.mode).toBeUndefined();

    const jwt = init.headers["Authorization"].match(/^vapid t=(\S+), k=(\S+)$/);
    expect(jwt).not.toBeNull();
    expect(jwt[1].split(".")).toHaveLength(3);

    // Real round-trip cross-check: decrypt the actual body sent to fetch
    // using the receiver's matching keypair, proving the wire format is
    // genuinely correct, not merely present.
    const decrypted = await decryptWebPushPayload(keyPair, subscriptionKeys.auth, init.body);
    expect(JSON.parse(decrypted)).toEqual(invitePayload);
  });

  it("returns false (does not throw) when fetchImpl rejects", async () => {
    const { subscriptionKeys } = await makeReceiverSubscriptionKeys();
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: subscriptionKeys };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

    await expect(
      sendPushNotification(subscription, { room: "room1", token: "tok1" }, { fetchImpl })
    ).resolves.toBe(false);
  });
});
