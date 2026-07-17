// Section PN2 (specs/phase5/push-notifications.md): a single, shared VAPID
// (Voluntary Application Server Identification) ES256 keypair, baked
// directly into the client -- BOTH public and private, since there is no
// Spirit application server to keep a secret on. VAPID exists purely for
// push-provider-level sender identification/rate-limiting, not as part of
// the E2E security boundary (actual payload content is separately encrypted
// per-recipient under that recipient's own subscription keys, webPushCrypto.js).
// Any Spirit client can therefore sign a valid VAPID JWT to push-notify any
// Spirit subscription -- an intentional, documented trade-off consistent
// with the project's no-central-authority model (same class of compromise
// as D3 in docs/decisions.md).

export const VAPID_PUBLIC_KEY_JWK = Object.freeze({
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  crv: "P-256",
  x: "bjWml7SEp2s3QQbqE-hb5vek6orxGhKqov5Vl9yls1g",
  y: "ULth9KV8KNCkV1DqpMmy0XxuBk7bSXRgV7dJi6DiDZM"
});

export const VAPID_PRIVATE_KEY_JWK = Object.freeze({
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  crv: "P-256",
  x: "bjWml7SEp2s3QQbqE-hb5vek6orxGhKqov5Vl9yls1g",
  y: "ULth9KV8KNCkV1DqpMmy0XxuBk7bSXRgV7dJi6DiDZM",
  d: "CpWkEncW5AJlCbt0Zy3DlHFYVNf_6OhVZmNyep5fxDo"
});

// The raw uncompressed P-256 point (65 bytes, base64url) -- exactly the
// format `PushManager.subscribe({ applicationServerKey })` expects.
export const VAPID_PUBLIC_KEY_RAW_BASE64URL =
  "BG41ppe0hKdrN0EG6hPoW-b3pOqK8RoSqqL-VZfcpbNYULth9KV8KNCkV1DqpMmy0XxuBk7bSXRgV7dJi6DiDZM";
