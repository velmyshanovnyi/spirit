// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildRecoveryShareAnnounce, parseRecoveryShareAnnounce, encodeShareAsText, decodeShareFromText } from "../js/recoveryShare.js";
import { bytesToBase64Url } from "../js/webPushCrypto.js";

const SHARE = { x: 3, y: new Uint8Array([1, 2, 3, 4, 5]), threshold: 2, totalShares: 3 };

describe("buildRecoveryShareAnnounce", () => {
  it("builds a control message with base64url-encoded y", () => {
    const announce = buildRecoveryShareAnnounce(SHARE);
    expect(announce).toEqual({
      type: "recovery-share-announce",
      x: 3,
      y: bytesToBase64Url(SHARE.y),
      threshold: 2,
      totalShares: 3
    });
  });
});

describe("parseRecoveryShareAnnounce", () => {
  it("round-trips a well-formed announce back into { x, y, threshold, totalShares }", () => {
    const announce = buildRecoveryShareAnnounce(SHARE);
    const parsed = parseRecoveryShareAnnounce(announce);
    expect(parsed.x).toBe(3);
    expect(parsed.threshold).toBe(2);
    expect(parsed.totalShares).toBe(3);
    expect(parsed.y).toEqual(SHARE.y);
  });

  it("returns null for null/undefined/non-object", () => {
    expect(parseRecoveryShareAnnounce(null)).toBeNull();
    expect(parseRecoveryShareAnnounce(undefined)).toBeNull();
    expect(parseRecoveryShareAnnounce("nope")).toBeNull();
  });

  it("returns null when x is missing or not a positive integer", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: undefined })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: 0 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: -1 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: 1.5 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: "3" })).toBeNull();
  });

  it("returns null when y is missing, empty, or not valid base64url", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), y: undefined })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), y: "" })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), y: 42 })).toBeNull();
  });

  it("returns null when threshold is missing, not an integer, or < 2", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: undefined })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: 1 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: 0 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: -2 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: 1.5 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: "2" })).toBeNull();
  });

  it("returns null when totalShares is missing, not an integer, or < 2", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), totalShares: undefined })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), totalShares: 1 })).toBeNull();
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), totalShares: 1.5 })).toBeNull();
  });

  it("returns null when threshold exceeds totalShares (malformed/hostile announce)", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: 5, totalShares: 3 })).toBeNull();
  });

  it("returns null when totalShares exceeds 255 (GF(256) share-count ceiling)", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), threshold: 2, totalShares: 256 })).toBeNull();
  });

  it("returns null when x exceeds totalShares (self-inconsistent announce)", () => {
    expect(parseRecoveryShareAnnounce({ ...buildRecoveryShareAnnounce(SHARE), x: 10, threshold: 2, totalShares: 3 })).toBeNull();
  });
});

describe("encodeShareAsText / decodeShareFromText (manual export channel)", () => {
  it("round-trips a share through the compact text encoding", () => {
    const text = encodeShareAsText(SHARE);
    expect(typeof text).toBe("string");
    const decoded = decodeShareFromText(text);
    expect(decoded).toEqual(SHARE);
  });

  it("returns null for garbage input", () => {
    expect(decodeShareFromText("not-a-share")).toBeNull();
    expect(decodeShareFromText("")).toBeNull();
    expect(decodeShareFromText(null)).toBeNull();
  });
});
