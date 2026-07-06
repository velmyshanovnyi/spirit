import { base64ToBytes } from "./codec.js";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const CLOCK_SKEW_SECONDS = 60;

function base64UrlToBytes(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  try {
    return base64ToBytes(base64 + padding);
  } catch {
    throw new Error("Malformed JWT: segment is not valid base64url");
  }
}

function decodeJsonObjectSegment(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Malformed JWT: segment is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Malformed JWT: segment must be a JSON object");
  }
  return value;
}

export function decodeJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected exactly 3 dot-separated segments");
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  return {
    header: decodeJsonObjectSegment(base64UrlToBytes(headerB64)),
    payload: decodeJsonObjectSegment(base64UrlToBytes(payloadB64)),
    signatureBytes: base64UrlToBytes(signatureB64),
    signingInput: `${headerB64}.${payloadB64}`
  };
}

export async function fetchGoogleJwks() {
  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: HTTP ${response.status}`);
  }
  return response.json();
}

async function importRsaPublicKeyFromJwk(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

/**
 * Verifies a Google OIDC ID token per docs/oauth-verification.md: signature
 * against Google's public JWKS, issuer, audience (client_id), nonce
 * (binding the token to a specific Spirit identity key), and expiry.
 * Throws with a descriptive message on any failure rather than returning a
 * falsy value, so callers can surface the specific reason to the user.
 *
 * `expectedNonce`/`expectedAudience` are required, non-empty strings --
 * deliberately not defaulted to undefined, because nonce-binding is this
 * attestation's entire security model (docs/oauth-verification.md
 * "Безпекові інваріанти"): a caller that forgets to pass one must fail
 * loudly rather than have `undefined === undefined` silently pass.
 *
 * `jwks` is a TEST-ONLY escape hatch for supplying a JWKS document instead
 * of fetching Google's real endpoint. Production callers must never pass
 * this -- it replaces the trust anchor itself.
 */
export async function verifyGoogleIdToken(
  token,
  { expectedNonce, expectedAudience, now = Date.now() / 1000, jwks } = {}
) {
  if (typeof expectedNonce !== "string" || expectedNonce === "") {
    throw new Error("Nonce mismatch: expectedNonce is required");
  }
  if (typeof expectedAudience !== "string" || expectedAudience === "") {
    throw new Error("Unexpected audience: expectedAudience is required");
  }

  const { header, payload, signatureBytes, signingInput } = decodeJwt(token);

  if (header.alg !== "RS256") {
    throw new Error(`Unexpected alg: expected RS256, got ${header.alg}`);
  }

  const keySet = jwks ?? (await fetchGoogleJwks());
  if (!keySet || !Array.isArray(keySet.keys)) {
    throw new Error("Malformed JWKS: expected a { keys: [...] } document");
  }
  const jwk = keySet.keys.find((key) => key.kid === header.kid);
  if (!jwk) {
    throw new Error("No matching signing key found in Google's JWKS for this token's kid");
  }
  const publicKey = await importRsaPublicKeyFromJwk(jwk);

  const isSignatureValid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    signatureBytes,
    new TextEncoder().encode(signingInput)
  );
  if (!isSignatureValid) {
    throw new Error("Invalid ID token signature");
  }

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new Error(`Unexpected issuer: ${payload.iss}`);
  }
  if (typeof payload.aud !== "string" || payload.aud !== expectedAudience) {
    throw new Error("Unexpected audience: client_id mismatch");
  }
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch: token was not issued for this identity key");
  }
  if (typeof payload.exp !== "number" || payload.exp < now - CLOCK_SKEW_SECONDS) {
    throw new Error("ID token has expired");
  }
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error("ID token issued-at time is invalid or in the future");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    issuedAt: payload.iat,
    expiresAt: payload.exp
  };
}

/**
 * Wraps Google Identity Services' callback-based One Tap/prompt API in a
 * Promise resolving to the raw ID token string (still unverified -- callers
 * must pass it to verifyGoogleIdToken with the same nonce/client_id before
 * trusting it). `googleSdk` defaults to the real `window.google` global (the
 * GSI script must already be loaded) but is injectable for testing.
 *
 * `initialize`'s credential callback and `prompt`'s notification callback
 * are two independent event sources in Google's real API and could both
 * fire for one call. Whichever settles this Promise first wins -- that's
 * native Promise behavior (a second resolve/reject is already a no-op per
 * spec, nothing here needs to guard it), but it does mean a notification
 * that fires before a genuine credential will report failure even though
 * a credential arrived a moment later. Out of scope to fix here (would
 * need e.g. a timeout/retry at the caller); documented so it isn't
 * mistaken for a bug later.
 */
export function promptGoogleSignIn({ clientId, nonce, googleSdk = globalThis.google } = {}) {
  return new Promise((resolve, reject) => {
    if (!googleSdk?.accounts?.id) {
      reject(new Error("Google Identity Services SDK not loaded"));
      return;
    }

    googleSdk.accounts.id.initialize({
      client_id: clientId,
      nonce,
      callback: (response) => {
        if (response?.credential) {
          resolve(response.credential);
        } else {
          reject(new Error("Google sign-in did not return a credential"));
        }
      }
    });

    googleSdk.accounts.id.prompt((notification) => {
      if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
        reject(new Error("Google sign-in prompt was not shown or was dismissed"));
      }
    });
  });
}
