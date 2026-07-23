// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { SETTINGS, getSetting, setSetting, resetSetting, resetAllSettings } from "../js/settingsRegistry.js";

beforeEach(() => {
  localStorage.clear();
});

describe("getSetting", () => {
  it("returns the registered default when nothing is stored", () => {
    expect(getSetting("proofFailureThreshold")).toBe(3);
  });

  it("throws for an unknown key rather than silently returning undefined", () => {
    expect(() => getSetting("notARealSetting")).toThrow();
  });

  it("falls back to the default when the stored value is out of range", () => {
    localStorage.setItem("spirit.settings.maxRecentAccounts", "9999");
    expect(getSetting("maxRecentAccounts")).toBe(10);
  });

  it("falls back to the default when the stored value isn't a valid number", () => {
    localStorage.setItem("spirit.settings.maxRecentAccounts", "not-a-number");
    expect(getSetting("maxRecentAccounts")).toBe(10);
  });
});

describe("setSetting", () => {
  it("persists a valid value and getSetting reflects it", () => {
    expect(setSetting("maxRecentAccounts", 25)).toBe(true);
    expect(getSetting("maxRecentAccounts")).toBe(25);
  });

  it("rejects an out-of-range value without persisting it", () => {
    expect(setSetting("maxRecentAccounts", 999)).toBe(false);
    expect(getSetting("maxRecentAccounts")).toBe(10);
  });

  it("rejects a non-numeric value for a numeric setting", () => {
    expect(setSetting("proofFailureThreshold", "banana")).toBe(false);
    expect(getSetting("proofFailureThreshold")).toBe(3);
  });
});

describe("resetSetting / resetAllSettings", () => {
  it("resetSetting reverts a single overridden value back to its default", () => {
    setSetting("proofFailureThreshold", 7);
    expect(getSetting("proofFailureThreshold")).toBe(7);
    resetSetting("proofFailureThreshold");
    expect(getSetting("proofFailureThreshold")).toBe(3);
  });

  it("resetAllSettings reverts every setting, not just one", () => {
    setSetting("proofFailureThreshold", 7);
    setSetting("maxRecentAccounts", 20);
    resetAllSettings();
    expect(getSetting("proofFailureThreshold")).toBe(3);
    expect(getSetting("maxRecentAccounts")).toBe(10);
  });
});

describe("SETTINGS registry shape", () => {
  it("every entry has the fields the UI needs to render itself structurally", () => {
    for (const entry of SETTINGS) {
      expect(entry.key).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.type).toBe("number");
      expect(typeof entry.default).toBe("number");
      expect(typeof entry.min).toBe("number");
      expect(typeof entry.max).toBe("number");
    }
  });

  it("has no duplicate keys", () => {
    const keys = SETTINGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
