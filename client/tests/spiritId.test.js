import { describe, it, expect } from "vitest";
import { SPIRIT_ID_PREFIX, formatSpiritId, parseSpiritId } from "../js/spiritId.js";

const FP = "ab12".repeat(16); // 64-char hex fingerprint

describe("formatSpiritId / parseSpiritId", () => {
  it("prefixes the fingerprint with spirit0001", () => {
    expect(SPIRIT_ID_PREFIX).toBe("spirit0001");
    expect(formatSpiritId(FP)).toBe(`spirit0001${FP}`);
  });

  it("round-trips exactly", () => {
    expect(parseSpiritId(formatSpiritId(FP))).toBe(FP);
  });

  it("returns null for a missing/foreign prefix or a non-hex remainder", () => {
    expect(parseSpiritId(FP)).toBeNull(); // bare fingerprint, no prefix
    expect(parseSpiritId(`spirit0002${FP}`)).toBeNull(); // unknown version
    expect(parseSpiritId("spirit0001" + "z".repeat(64))).toBeNull(); // non-hex
    expect(parseSpiritId("spirit0001" + "a".repeat(63))).toBeNull(); // wrong length
    expect(parseSpiritId(null)).toBeNull();
    expect(parseSpiritId("")).toBeNull();
  });
});
