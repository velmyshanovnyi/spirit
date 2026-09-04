// User request (2026-08-08): a free, no-signup public TURN preset for the
// STUN/TURN dropdown. Researched live (WebFetch against
// metered.ca/tools/openrelay/) before writing this: the commonly
// copy-pasted static "openrelayproject"/"openrelayproject" username/password
// pair is stale -- the official docs now require signup + an API key for
// that endpoint. The one mechanism still documented WITHOUT signup is
// staticauth.openrelay.metered.ca's shared-secret scheme, the standard
// coturn "TURN REST API" / use-auth-secret convention:
//   username   = "<unixExpiryTimestamp>:<label>"
//   credential = base64(HMAC-SHA1(sharedSecret, username))
//
// Cross-language test vectors: HMAC-SHA1 hand-computed via an INDEPENDENT
// Node script (`crypto.createHmac("sha1", secret).update(username).digest("base64")`),
// not this codebase's own implementation -- same style as pow.test.js's
// VECTORS. If this file's HMAC construction diverges from the real scheme
// (wrong key/message order, wrong hash, hex instead of base64, etc.),
// exactly these assertions fail.
import { describe, it, expect } from "vitest";
import { computeTurnRestCredential } from "../js/turnCredentials.js";

describe("computeTurnRestCredential", () => {
  it("matches an independently-computed HMAC-SHA1 vector (test secret)", async () => {
    // node -e "console.log(require('crypto').createHmac('sha1','test-shared-secret').update('1700000000:testlabel').digest('base64'))"
    // -> EnoleNh4zWM2io9GjC3/qTJ3MAc=
    const { username, credential } = await computeTurnRestCredential("test-shared-secret", {
      now: 1700000000000 - 86400000, // now + default 86400s ttl = 1700000000
      label: "testlabel"
    });
    expect(username).toBe("1700000000:testlabel");
    expect(credential).toBe("EnoleNh4zWM2io9GjC3/qTJ3MAc=");
  });

  it("matches a second independently-computed vector (the actual Metered shared secret + default label)", async () => {
    // node -e "console.log(require('crypto').createHmac('sha1','openrelayprojectsecret').update('86400:spirit').digest('base64'))"
    // -> oR2AP32JFC3Z3htH8Q2vHbk9Z0k=
    const { username, credential } = await computeTurnRestCredential("openrelayprojectsecret", { now: 0 });
    expect(username).toBe("86400:spirit");
    expect(credential).toBe("oR2AP32JFC3Z3htH8Q2vHbk9Z0k=");
  });

  it("expiry timestamp is floor(now/1000) + ttlSeconds, not off by a rounding/unit error", async () => {
    const { username } = await computeTurnRestCredential("s", { now: 1000, ttlSeconds: 5, label: "x" });
    expect(username).toBe("6:x"); // floor(1000/1000) + 5 = 6
  });

  it("defaults ttlSeconds to 86400 (24h) and label to 'spirit' when omitted", async () => {
    const { username } = await computeTurnRestCredential("s", { now: 0 });
    expect(username).toBe("86400:spirit");
  });

  it("produces a DIFFERENT credential for a different secret, same everything else (the HMAC key actually matters)", async () => {
    const a = await computeTurnRestCredential("secret-a", { now: 0, label: "x" });
    const b = await computeTurnRestCredential("secret-b", { now: 0, label: "x" });
    expect(a.credential).not.toBe(b.credential);
    expect(a.username).toBe(b.username); // username doesn't depend on the secret
  });

  it("produces a DIFFERENT credential for a different username, same secret (the message actually matters)", async () => {
    const a = await computeTurnRestCredential("s", { now: 0, label: "x" });
    const b = await computeTurnRestCredential("s", { now: 0, label: "y" });
    expect(a.credential).not.toBe(b.credential);
  });
});
