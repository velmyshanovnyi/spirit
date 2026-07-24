// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  DESIGN_SETTINGS,
  getDesignSetting,
  setDesignSetting,
  resetDesignSetting,
  resetAllDesignSettings,
  applyDesignSettings
} from "../js/designSettingsRegistry.js";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("getDesignSetting", () => {
  it("returns null (no override) when nothing is stored", () => {
    expect(getDesignSetting("accentColor")).toBeNull();
  });

  it("throws for an unknown key", () => {
    expect(() => getDesignSetting("notReal")).toThrow();
  });

  it("returns null for a corrupted/out-of-range length value instead of throwing", () => {
    localStorage.setItem("spirit.designSettings.cornerRadius", "9999");
    expect(getDesignSetting("cornerRadius")).toBeNull();
  });
});

describe("setDesignSetting", () => {
  it("persists a valid hex color", () => {
    expect(setDesignSetting("accentColor", "#ff0000")).toBe(true);
    expect(getDesignSetting("accentColor")).toBe("#ff0000");
  });

  it("rejects a non-hex color value", () => {
    expect(setDesignSetting("accentColor", "red")).toBe(false);
    expect(getDesignSetting("accentColor")).toBeNull();
  });

  it("rejects an out-of-range length", () => {
    expect(setDesignSetting("cornerRadius", 999)).toBe(false);
    expect(getDesignSetting("cornerRadius")).toBeNull();
  });

  it("persists a valid font stack string", () => {
    expect(setDesignSetting("fontFamily", "Georgia, serif")).toBe(true);
    expect(getDesignSetting("fontFamily")).toBe("Georgia, serif");
  });

  it("rejects an empty font stack", () => {
    expect(setDesignSetting("fontFamily", "   ")).toBe(false);
  });
});

describe("resetDesignSetting / resetAllDesignSettings", () => {
  it("resetDesignSetting reverts a single override", () => {
    setDesignSetting("accentColor", "#ff0000");
    resetDesignSetting("accentColor");
    expect(getDesignSetting("accentColor")).toBeNull();
  });

  it("resetAllDesignSettings reverts every override, not just one", () => {
    setDesignSetting("accentColor", "#ff0000");
    setDesignSetting("cornerRadius", 20);
    resetAllDesignSettings();
    expect(getDesignSetting("accentColor")).toBeNull();
    expect(getDesignSetting("cornerRadius")).toBeNull();
  });
});

describe("applyDesignSettings", () => {
  it("sets an inline CSS custom property on :root for each stored override", () => {
    setDesignSetting("accentColor", "#ff0000");
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff0000");
  });

  it("appends px for length-type settings", () => {
    setDesignSetting("cornerRadius", 20);
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("20px");
  });

  it("removes the inline override for a setting that was reset", () => {
    setDesignSetting("accentColor", "#ff0000");
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#ff0000");

    resetDesignSetting("accentColor");
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
  });
});

describe("DESIGN_SETTINGS registry shape", () => {
  it("every entry has the fields the UI needs to render itself structurally", () => {
    for (const entry of DESIGN_SETTINGS) {
      expect(entry.key).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(["color", "length", "text"]).toContain(entry.type);
      expect(entry.cssVar.startsWith("--")).toBe(true);
    }
  });

  it("has no duplicate keys", () => {
    const keys = DESIGN_SETTINGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
