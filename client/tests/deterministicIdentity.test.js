import { describe, it, expect } from "vitest";
import { deriveAccountMaterial } from "../js/deterministicIdentity.js";

// Argon2id at production parameters (128 MiB, t=3) is intentionally slow --
// give these tests headroom well above the default 5s.
const TIMEOUT_MS = 20000;

describe("deriveAccountMaterial", () => {
  it(
    "returns a 32-byte private key scalar and a 16-char base64url verifier tail",
    async () => {
      const { privateKeyScalar, verifierTail } = await deriveAccountMaterial("abcdefghij", "correct horse battery staple long enough");

      expect(privateKeyScalar).toBeInstanceOf(Uint8Array);
      expect(privateKeyScalar.length).toBe(32);
      expect(typeof verifierTail).toBe("string");
      expect(verifierTail.length).toBe(16);
      expect(verifierTail).toMatch(/^[A-Za-z0-9_-]{16}$/);
    },
    TIMEOUT_MS
  );

  it(
    "is deterministic: the same (name, password) always derives the same material",
    async () => {
      const a = await deriveAccountMaterial("sameName01", "same password phrase");
      const b = await deriveAccountMaterial("sameName01", "same password phrase");

      expect(a.verifierTail).toBe(b.verifierTail);
      expect([...a.privateKeyScalar]).toEqual([...b.privateKeyScalar]);
    },
    TIMEOUT_MS
  );

  it(
    "a different password changes both the key scalar and the verifier tail",
    async () => {
      const a = await deriveAccountMaterial("sameName01", "password one");
      const b = await deriveAccountMaterial("sameName01", "password two");

      expect(a.verifierTail).not.toBe(b.verifierTail);
      expect([...a.privateKeyScalar]).not.toEqual([...b.privateKeyScalar]);
    },
    TIMEOUT_MS
  );

  it(
    "a different name (salt) changes both the key scalar and the verifier tail",
    async () => {
      const a = await deriveAccountMaterial("nameAAAAAA", "the same password");
      const b = await deriveAccountMaterial("nameBBBBBB", "the same password");

      expect(a.verifierTail).not.toBe(b.verifierTail);
      expect([...a.privateKeyScalar]).not.toEqual([...b.privateKeyScalar]);
    },
    TIMEOUT_MS
  );

  it(
    "the key scalar and verifier tail are independent segments, not derivable from each other",
    async () => {
      // Regression guard against accidentally reusing the same byte range for
      // both outputs -- the tail must not simply be an encoding of the scalar.
      const { privateKeyScalar, verifierTail } = await deriveAccountMaterial("indepCheck", "some password");
      const scalarAsBase64url = Buffer.from(privateKeyScalar).toString("base64url").slice(0, 16);

      expect(verifierTail).not.toBe(scalarAsBase64url);
    },
    TIMEOUT_MS
  );
});
