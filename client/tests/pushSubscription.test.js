// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildPushSubscribeOptions,
  serializeSubscriptionForAnnounce,
  parsePushSubscriptionAnnounce
} from "../js/pushSubscription.js";
import { base64UrlToBytes } from "../js/webPushCrypto.js";

describe("buildPushSubscribeOptions", () => {
  it("returns userVisibleOnly:true and a decoded applicationServerKey", () => {
    const vapidPublicKey = "BNbxGYNMhEIRi9YWlqzq5x8vcHrPh6oOhqEqzTFV_RA2y0FYSjT0y-5tGeK0Ph8dNxG9Tw3xNRHCzfP7t_L3jFA";
    const options = buildPushSubscribeOptions(vapidPublicKey);
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(options.applicationServerKey).toEqual(base64UrlToBytes(vapidPublicKey));
  });
});

describe("serializeSubscriptionForAnnounce", () => {
  it("serializes a plain {endpoint, keys} object", () => {
    const subscription = { endpoint: "https://push.example/x", keys: { p256dh: "p256dhval", auth: "authval" } };
    expect(serializeSubscriptionForAnnounce(subscription)).toEqual({
      type: "push-subscription-announce",
      endpoint: "https://push.example/x",
      keys: { p256dh: "p256dhval", auth: "authval" }
    });
  });

  it("serializes a PushSubscription-shaped mock with toJSON()", () => {
    const subscription = {
      toJSON: () => ({ endpoint: "https://push.example/y", keys: { p256dh: "p2", auth: "a2" } })
    };
    expect(serializeSubscriptionForAnnounce(subscription)).toEqual({
      type: "push-subscription-announce",
      endpoint: "https://push.example/y",
      keys: { p256dh: "p2", auth: "a2" }
    });
  });

  it("returns null when endpoint is missing", () => {
    expect(serializeSubscriptionForAnnounce({ keys: { p256dh: "p", auth: "a" } })).toBeNull();
  });

  it("returns null when keys is missing", () => {
    expect(serializeSubscriptionForAnnounce({ endpoint: "https://push.example/x" })).toBeNull();
  });

  it("returns null when p256dh or auth is missing/wrong type", () => {
    expect(
      serializeSubscriptionForAnnounce({ endpoint: "https://push.example/x", keys: { auth: "a" } })
    ).toBeNull();
    expect(
      serializeSubscriptionForAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: "p" } })
    ).toBeNull();
    expect(
      serializeSubscriptionForAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: 1, auth: "a" } })
    ).toBeNull();
  });
});

describe("parsePushSubscriptionAnnounce", () => {
  it("returns { endpoint, keys } for a well-formed control message", () => {
    const control = {
      type: "push-subscription-announce",
      endpoint: "https://push.example/x",
      keys: { p256dh: "p256dhval", auth: "authval" }
    };
    expect(parsePushSubscriptionAnnounce(control)).toEqual({
      endpoint: "https://push.example/x",
      keys: { p256dh: "p256dhval", auth: "authval" }
    });
  });

  it("returns null for null/undefined", () => {
    expect(parsePushSubscriptionAnnounce(null)).toBeNull();
    expect(parsePushSubscriptionAnnounce(undefined)).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parsePushSubscriptionAnnounce("string")).toBeNull();
    expect(parsePushSubscriptionAnnounce(42)).toBeNull();
  });

  it("returns null when endpoint is missing, empty, or the wrong type", () => {
    expect(parsePushSubscriptionAnnounce({ keys: { p256dh: "p", auth: "a" } })).toBeNull();
    expect(parsePushSubscriptionAnnounce({ endpoint: "", keys: { p256dh: "p", auth: "a" } })).toBeNull();
    expect(parsePushSubscriptionAnnounce({ endpoint: 123, keys: { p256dh: "p", auth: "a" } })).toBeNull();
  });

  it("returns null when keys is missing or not an object", () => {
    expect(parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x" })).toBeNull();
    expect(parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: "nope" })).toBeNull();
  });

  it("returns null when p256dh is missing, empty, or wrong type", () => {
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { auth: "a" } })
    ).toBeNull();
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: "", auth: "a" } })
    ).toBeNull();
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: 1, auth: "a" } })
    ).toBeNull();
  });

  it("returns null when auth is missing, empty, or wrong type", () => {
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: "p" } })
    ).toBeNull();
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "" } })
    ).toBeNull();
    expect(
      parsePushSubscriptionAnnounce({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: 1 } })
    ).toBeNull();
  });
});
