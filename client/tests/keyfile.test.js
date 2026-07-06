import { describe, it, expect } from "vitest";
import { createKeyfile, restoreFromKeyfile, IncorrectPassphraseError } from "../js/keyfile.js";

describe("createKeyfile", () => {
  it("returns a JSON-serializable structure with a version, salt, and encrypted ciphertext", async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyfile = await createKeyfile(rawKeyBytes, "my passphrase");

    expect(typeof keyfile.version).toBe("number");
    expect(typeof keyfile.salt).toBe("string");
    expect(typeof keyfile.ciphertext).toBe("string");

    // Fresh salt and IV per call: two keyfiles for the same key+passphrase
    // must not be identical (would indicate a fixed/reused salt or IV).
    const second = await createKeyfile(rawKeyBytes, "my passphrase");
    expect(second.salt).not.toBe(keyfile.salt);
    expect(second.ciphertext).not.toBe(keyfile.ciphertext);

    // Must survive an actual JSON round-trip (as if saved to / loaded from a file).
    const reparsed = JSON.parse(JSON.stringify(keyfile));
    expect(reparsed).toEqual(keyfile);
  });

  it("does not store the plaintext key bytes anywhere in the structure", async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyfile = await createKeyfile(rawKeyBytes, "my passphrase");

    const rawBase64 = btoa(String.fromCharCode(...rawKeyBytes));
    expect(JSON.stringify(keyfile)).not.toContain(rawBase64);
  });
});

describe("restoreFromKeyfile", () => {
  it("round-trips the exact original raw key bytes with the correct passphrase", async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyfile = await createKeyfile(rawKeyBytes, "correct horse battery staple");

    const restored = await restoreFromKeyfile(keyfile, "correct horse battery staple");

    expect(restored).toEqual(rawKeyBytes);
  });

  it("survives a real JSON.stringify/parse round-trip before restoring", async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyfile = await createKeyfile(rawKeyBytes, "pw");
    const reloaded = JSON.parse(JSON.stringify(keyfile));

    const restored = await restoreFromKeyfile(reloaded, "pw");

    expect(restored).toEqual(rawKeyBytes);
  });

  it("throws a clear domain error for a wrong passphrase", async () => {
    const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    const keyfile = await createKeyfile(rawKeyBytes, "the real passphrase");

    await expect(restoreFromKeyfile(keyfile, "wrong passphrase")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("throws a clear error for an unsupported or malformed keyfile format", async () => {
    await expect(restoreFromKeyfile({ version: 999, salt: "x", ciphertext: "y" }, "pw")).rejects.toThrow(
      /unsupported|malformed/i
    );
    await expect(restoreFromKeyfile(null, "pw")).rejects.toThrow(/unsupported|malformed/i);
    await expect(restoreFromKeyfile({}, "pw")).rejects.toThrow(/unsupported|malformed/i);
  });

  it("throws the malformed-keyfile error (not a raw base64 exception) when salt isn't valid base64", async () => {
    await expect(
      restoreFromKeyfile({ version: 1, salt: "!!!not-valid-base64!!!", ciphertext: "AAAA" }, "pw")
    ).rejects.toThrow(/unsupported|malformed/i);
  });
});
