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

describe("Section RF15: layout width settings", () => {
  it("applyDesignSettings sets --content-max-width/--sidebar-width in px when overridden", () => {
    setDesignSetting("contentMaxWidth", 1600);
    setDesignSetting("sidebarWidth", 260);
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--content-max-width")).toBe("1600px");
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("260px");
  });

  it("rejects a sidebar width outside the safe range", () => {
    expect(setDesignSetting("sidebarWidth", 10)).toBe(false);
    expect(setDesignSetting("sidebarWidth", 5000)).toBe(false);
  });
});

describe("Section RF16: element visibility settings", () => {
  it("getDesignSetting returns null (== visible) when nothing is stored", () => {
    expect(getDesignSetting("folderTree")).toBeNull();
  });

  it("setDesignSetting persists a boolean and getDesignSetting reads it back", () => {
    expect(setDesignSetting("folderTree", false)).toBe(true);
    expect(getDesignSetting("folderTree")).toBe(false);
    expect(setDesignSetting("folderTree", true)).toBe(true);
    expect(getDesignSetting("folderTree")).toBe(true);
  });

  it("applyDesignSettings hides the matched element when set to false, shows it again on reset", () => {
    const node = document.createElement("div");
    node.id = "folder-tree";
    document.body.appendChild(node);

    setDesignSetting("folderTree", false);
    applyDesignSettings(document);
    expect(node.style.display).toBe("none");

    resetDesignSetting("folderTree");
    applyDesignSettings(document);
    expect(node.style.display).toBe("");

    document.body.removeChild(node);
  });
});

describe("Section RF17: layout edit mode -- sidebar side swap", () => {
  it("getDesignSetting returns null (== default left) when nothing is stored", () => {
    expect(getDesignSetting("sidebarSide")).toBeNull();
  });

  it("setDesignSetting persists a valid choice value and rejects an invalid one", () => {
    expect(setDesignSetting("sidebarSide", "right")).toBe(true);
    expect(getDesignSetting("sidebarSide")).toBe("right");
    expect(setDesignSetting("sidebarSide", "up")).toBe(false);
  });

  it("applyDesignSettings sets/removes a data attribute on :root for a choice setting", () => {
    setDesignSetting("sidebarSide", "right");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.sidebarSide).toBe("right");

    resetDesignSetting("sidebarSide");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.sidebarSide).toBeUndefined();
  });
});

describe("Section RF18: layout edit mode -- conversation toolbar side swap", () => {
  it("getDesignSetting returns null (== default left) when nothing is stored", () => {
    expect(getDesignSetting("toolbarSide")).toBeNull();
  });

  it("setDesignSetting persists a valid choice value and rejects an invalid one", () => {
    expect(setDesignSetting("toolbarSide", "right")).toBe(true);
    expect(getDesignSetting("toolbarSide")).toBe("right");
    expect(setDesignSetting("toolbarSide", "up")).toBe(false);
  });

  it("applyDesignSettings sets/removes a data attribute on :root for a choice setting", () => {
    setDesignSetting("toolbarSide", "right");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.toolbarSide).toBe("right");

    resetDesignSetting("toolbarSide");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.toolbarSide).toBeUndefined();
  });
});

describe("DESIGN_SETTINGS registry shape", () => {
  it("every entry has the fields the UI needs to render itself structurally", () => {
    for (const entry of DESIGN_SETTINGS) {
      expect(entry.key).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(["color", "length", "text", "boolean", "choice"]).toContain(entry.type);
      if (entry.type === "boolean") {
        expect(entry.selector).toBeTruthy();
      } else if (entry.type === "choice") {
        expect(Array.isArray(entry.options) && entry.options.length >= 2).toBe(true);
        expect(entry.rootAttribute).toBeTruthy();
      } else {
        expect(entry.cssVar.startsWith("--")).toBe(true);
      }
    }
  });

  it("has no duplicate keys", () => {
    const keys = DESIGN_SETTINGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
