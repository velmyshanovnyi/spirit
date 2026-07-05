import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeJwt, fetchGoogleJwks, verifyGoogleIdToken, promptGoogleSignIn } from "../js/googleOAuth.js";

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateTestRsaKeyPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}

async function signTestJwt(keyPair, kid, header, payload) {
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ ...header, kid })));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput)
  );
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

async function jwkFor(keyPair, kid) {
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { ...jwk, kid, alg: "RS256", use: "sig" };
}

const VALID_HEADER = { alg: "RS256", typ: "JWT" };
const NOW = Math.floor(Date.now() / 1000);

function validPayload(overrides = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: "test-client-id",
    sub: "1234567890",
    email: "user@gmail.com",
    email_verified: true,
    nonce: "expected-nonce-abc",
    iat: NOW - 10,
    exp: NOW + 3600,
    ...overrides
  };
}

describe("decodeJwt", () => {
  it("parses header, payload, and signature from a well-formed JWT", async () => {
    const keyPair = await generateTestRsaKeyPair();
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload());

    const decoded = decodeJwt(token);

    expect(decoded.header.alg).toBe("RS256");
    expect(decoded.header.kid).toBe("kid-1");
    expect(decoded.payload.email).toBe("user@gmail.com");
    expect(decoded.signatureBytes).toBeInstanceOf(Uint8Array);
    expect(decoded.signatureBytes.length).toBeGreaterThan(0);
  });

  it("throws on a token that doesn't have exactly 3 segments", () => {
    expect(() => decodeJwt("only.two")).toThrow();
    expect(() => decodeJwt("a.b.c.d")).toThrow();
  });
});

describe("verifyGoogleIdToken", () => {
  let keyPair;
  let jwks;

  beforeEach(async () => {
    keyPair = await generateTestRsaKeyPair();
    jwks = { keys: [await jwkFor(keyPair, "kid-1")] };
  });

  it("verifies a correctly signed token with matching nonce/audience and returns the claims", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload());

    const result = await verifyGoogleIdToken(token, {
      expectedNonce: "expected-nonce-abc",
      expectedAudience: "test-client-id",
      now: NOW,
      jwks
    });

    expect(result).toEqual({
      sub: "1234567890",
      email: "user@gmail.com",
      emailVerified: true,
      issuedAt: NOW - 10,
      expiresAt: NOW + 3600
    });
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload());
    const tampered = token.slice(0, -2) + (token.slice(-2) === "AA" ? "BB" : "AA");

    await expect(
      verifyGoogleIdToken(tampered, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow();
  });

  it("rejects a nonce mismatch (token not issued for this identity key)", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload({ nonce: "someone-elses-nonce" }));

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects an audience (client_id) mismatch", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload({ aud: "some-other-client-id" }));

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/audience/i);
  });

  it("rejects a non-Google issuer", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload({ iss: "https://evil.example" }));

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/issuer/i);
  });

  it("rejects an expired token", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload({ exp: NOW - 100 }));

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a token whose kid isn't present in the JWKS", async () => {
    const token = await signTestJwt(keyPair, "unknown-kid", VALID_HEADER, validPayload());

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/kid|key/i);
  });

  it("rejects when the token omits the nonce claim entirely, even if the caller forgets to pass expectedNonce", async () => {
    const { nonce, ...payloadWithoutNonce } = validPayload();
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, payloadWithoutNonce);

    // expectedNonce intentionally omitted -- this must NOT silently pass via
    // undefined === undefined, since nonce-binding is the entire security
    // model of this attestation (docs/oauth-verification.md).
    await expect(
      verifyGoogleIdToken(token, { expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/nonce/i);
  });

  it("rejects when the caller omits expectedAudience, even if the token also omits aud", async () => {
    const { aud, ...payloadWithoutAud } = validPayload();
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, payloadWithoutAud);

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", now: NOW, jwks })
    ).rejects.toThrow(/audience/i);
  });

  it("rejects a token whose header declares an algorithm other than RS256", async () => {
    const token = await signTestJwt(keyPair, "kid-1", { alg: "none", typ: "JWT" }, validPayload());

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/alg/i);
  });

  it("rejects a token with a tampered payload even though the raw signature bytes are untouched", async () => {
    const token = await signTestJwt(keyPair, "kid-1", VALID_HEADER, validPayload());
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const forgedPayloadB64 = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify(validPayload({ email: "attacker@evil.example" })))
    );
    const forgedToken = `${headerB64}.${forgedPayloadB64}.${signatureB64}`;

    await expect(
      verifyGoogleIdToken(forgedToken, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/signature/i);
  });

  it("rejects a malformed base64url segment with a clear error instead of a raw atob exception", async () => {
    const token = "not-valid-base64!!!.not-valid-base64!!!.not-valid-base64!!!";

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/malformed/i);
  });

  it("rejects a token whose payload is valid JSON but not an object", async () => {
    const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(VALID_HEADER)));
    const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(["not", "an", "object"])));
    const token = `${encodedHeader}.${encodedPayload}.deadbeef`;

    await expect(
      verifyGoogleIdToken(token, { expectedNonce: "expected-nonce-abc", expectedAudience: "test-client-id", now: NOW, jwks })
    ).rejects.toThrow(/malformed/i);
  });
});

describe("fetchGoogleJwks", () => {
  it("fetches and returns the JWKS document from Google's certs endpoint", async () => {
    const fakeJwks = { keys: [{ kid: "abc", kty: "RSA" }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fakeJwks });

    const result = await fetchGoogleJwks();

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("googleapis.com"));
    expect(result).toEqual(fakeJwks);
  });

  it("throws a clear error if the JWKS endpoint responds with a non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    await expect(fetchGoogleJwks()).rejects.toThrow(/500/);
  });
});

describe("promptGoogleSignIn", () => {
  it("initializes the Google SDK with the given client_id/nonce and resolves with the returned credential", async () => {
    let capturedConfig;
    const fakeGoogleSdk = {
      accounts: {
        id: {
          initialize: vi.fn((config) => {
            capturedConfig = config;
          }),
          prompt: vi.fn(() => {
            capturedConfig.callback({ credential: "FAKE_ID_TOKEN" });
          })
        }
      }
    };

    const token = await promptGoogleSignIn({ clientId: "test-client-id", nonce: "nonce-abc", googleSdk: fakeGoogleSdk });

    expect(fakeGoogleSdk.accounts.id.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "test-client-id", nonce: "nonce-abc" })
    );
    expect(token).toBe("FAKE_ID_TOKEN");
  });

  it("rejects if the Google SDK isn't loaded", async () => {
    await expect(promptGoogleSignIn({ clientId: "x", nonce: "y", googleSdk: undefined })).rejects.toThrow(/not loaded/i);
  });

  it("rejects if the callback fires without a credential", async () => {
    const fakeGoogleSdk = {
      accounts: {
        id: {
          initialize: vi.fn((config) => {
            config.callback({});
          }),
          prompt: vi.fn()
        }
      }
    };

    await expect(promptGoogleSignIn({ clientId: "x", nonce: "y", googleSdk: fakeGoogleSdk })).rejects.toThrow(/credential/i);
  });

  it("rejects if the prompt is not displayed or is skipped", async () => {
    const fakeGoogleSdk = {
      accounts: {
        id: {
          initialize: vi.fn(),
          prompt: vi.fn((onNotification) => {
            onNotification({ isNotDisplayed: () => true, isSkippedMoment: () => false });
          })
        }
      }
    };

    await expect(promptGoogleSignIn({ clientId: "x", nonce: "y", googleSdk: fakeGoogleSdk })).rejects.toThrow(/not shown|dismissed/i);
  });

  it("resolves the promise from whichever of the two independent callbacks fires first (native first-settle-wins)", async () => {
    let capturedConfig;
    let capturedNotify;
    const fakeGoogleSdk = {
      accounts: {
        id: {
          initialize: vi.fn((config) => {
            capturedConfig = config;
          }),
          prompt: vi.fn((onNotification) => {
            capturedNotify = onNotification;
          })
        }
      }
    };

    const promise = promptGoogleSignIn({ clientId: "x", nonce: "y", googleSdk: fakeGoogleSdk });

    // Notification fires first (e.g. a transient "skipped moment"), THEN a
    // real credential arrives from the same in-flight prompt. This documents
    // the intended contract (first event wins) rather than testing any
    // custom guard -- native Promise settle-once semantics already make
    // this deterministic.
    capturedNotify({ isNotDisplayed: () => false, isSkippedMoment: () => true });
    capturedConfig.callback({ credential: "LATE_CREDENTIAL" });

    await expect(promise).rejects.toThrow(/not shown|dismissed/i);
  });
});
