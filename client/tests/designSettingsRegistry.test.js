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
import { t, setLocale } from "../js/i18n.js";

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

// Section RF22 (specs/ui/design-edit-mode.md, Stage 2): same "type: length"
// pattern as contentMaxWidth/sidebarWidth above -- new CSS var, applied on
// the conversation screen's own .card-wide AND .layout (exec review
// finding 1: .layout's hardcoded max-width:1100px would otherwise cap the
// card at ~1052px regardless of this setting's value).
describe("Section RF22: layout edit mode -- conversation width", () => {
  it("getDesignSetting returns null (== default 1100px) when nothing is stored", () => {
    expect(getDesignSetting("conversationWidth")).toBeNull();
  });

  it("setDesignSetting persists a valid width and rejects one outside the safe range", () => {
    expect(setDesignSetting("conversationWidth", 1400)).toBe(true);
    expect(getDesignSetting("conversationWidth")).toBe(1400);
    expect(setDesignSetting("conversationWidth", 100)).toBe(false);
    expect(setDesignSetting("conversationWidth", 5000)).toBe(false);
  });

  it("applyDesignSettings sets/removes --conversation-width in px on :root", () => {
    setDesignSetting("conversationWidth", 900);
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--conversation-width")).toBe("900px");

    resetDesignSetting("conversationWidth");
    applyDesignSettings(document);
    expect(document.documentElement.style.getPropertyValue("--conversation-width")).toBe("");
  });
});

// Section RF23 (specs/ui/design-edit-mode.md, Stage 2): same "type: choice"
// pattern as sidebarSide/toolbarSide/videoMode -- controls WHERE the SM3
// "розділ вимкнено" toast (#advanced-mode-notice) appears on screen.
describe("Section RF23: layout edit mode -- restricted-route notice position", () => {
  it("getDesignSetting returns null (== default bottom-center) when nothing is stored", () => {
    expect(getDesignSetting("noticePosition")).toBeNull();
  });

  it("setDesignSetting persists a valid position and rejects an invalid one", () => {
    expect(setDesignSetting("noticePosition", "top-left")).toBe(true);
    expect(getDesignSetting("noticePosition")).toBe("top-left");
    expect(setDesignSetting("noticePosition", "middle")).toBe(false);
  });

  it("accepts all six documented positions", () => {
    for (const position of ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"]) {
      expect(setDesignSetting("noticePosition", position)).toBe(true);
    }
  });

  it("applyDesignSettings sets/removes a data attribute on :root for a choice setting", () => {
    setDesignSetting("noticePosition", "top-right");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.noticePosition).toBe("top-right");

    resetDesignSetting("noticePosition");
    applyDesignSettings(document);
    expect(document.documentElement.dataset.noticePosition).toBeUndefined();
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

describe("Section RF19: layout edit mode -- header controls order", () => {
  it("getDesignSetting returns null (== default DOM order) when nothing is stored", () => {
    expect(getDesignSetting("headerControlsOrder")).toBeNull();
  });

  it("setDesignSetting persists a valid permutation and rejects an invalid one", () => {
    const validOrder = ["themeToggle", "langSelect", "settingsGear", "headerCallControls"];
    expect(setDesignSetting("headerControlsOrder", validOrder)).toBe(true);
    expect(getDesignSetting("headerControlsOrder")).toEqual(validOrder);

    expect(setDesignSetting("headerControlsOrder", ["langSelect", "themeToggle"])).toBe(false); // wrong length
    expect(setDesignSetting("headerControlsOrder", ["langSelect", "themeToggle", "settingsGear", "notReal"])).toBe(false); // unknown item key
  });

  it("applyDesignSettings sets inline order per item when overridden, removes it on reset", () => {
    const langNode = document.createElement("select");
    langNode.id = "lang-select";
    const themeNode = document.createElement("button");
    themeNode.id = "theme-toggle";
    const gearNode = document.createElement("div");
    gearNode.className = "settings-wrap";
    const callNode = document.createElement("span");
    callNode.id = "header-call-controls";
    document.body.append(langNode, themeNode, gearNode, callNode);

    setDesignSetting("headerControlsOrder", ["themeToggle", "langSelect", "settingsGear", "headerCallControls"]);
    applyDesignSettings(document);
    expect(themeNode.style.order).toBe("0");
    expect(langNode.style.order).toBe("1");
    expect(gearNode.style.order).toBe("2");
    expect(callNode.style.order).toBe("3");

    resetDesignSetting("headerControlsOrder");
    applyDesignSettings(document);
    expect(themeNode.style.order).toBe("");
    expect(langNode.style.order).toBe("");
    expect(gearNode.style.order).toBe("");
    expect(callNode.style.order).toBe("");

    document.body.removeChild(langNode);
    document.body.removeChild(themeNode);
    document.body.removeChild(gearNode);
    document.body.removeChild(callNode);
  });
});

describe("DESIGN_SETTINGS registry shape", () => {
  it("every entry has the fields the UI needs to render itself structurally", () => {
    for (const entry of DESIGN_SETTINGS) {
      expect(entry.key).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.labelKey).toBeTruthy();
      expect(entry.descriptionKey).toBeTruthy();
      expect(["color", "length", "text", "boolean", "choice", "order"]).toContain(entry.type);
      if (entry.type === "boolean") {
        expect(entry.selector).toBeTruthy();
      } else if (entry.type === "choice") {
        expect(Array.isArray(entry.options) && entry.options.length >= 2).toBe(true);
        expect(entry.rootAttribute).toBeTruthy();
        for (const option of entry.options) {
          expect(entry.optionLabelKeys[option]).toBeTruthy();
        }
      } else if (entry.type === "order") {
        expect(Array.isArray(entry.items) && entry.items.length >= 2).toBe(true);
        for (const item of entry.items) {
          expect(item.key).toBeTruthy();
          expect(item.labelKey).toBeTruthy();
          expect(item.selector).toBeTruthy();
        }
      } else {
        expect(entry.cssVar.startsWith("--")).toBe(true);
      }
    }
  });

  it("has no duplicate keys", () => {
    const keys = DESIGN_SETTINGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Section C6 (specs/reviews/spirit-evaluation-triage.md): same fix as
  // SETTINGS -- labels/descriptions (plus choice optionLabels and order
  // item labels) used to be hardcoded Ukrainian strings, unreachable from
  // the language switcher.
  it("every labelKey/descriptionKey (and choice/order sub-labels) resolves to a real translation in en and uk", () => {
    for (const locale of ["en", "uk"]) {
      setLocale(locale);
      for (const entry of DESIGN_SETTINGS) {
        expect(t(entry.labelKey)).not.toBe(entry.labelKey);
        expect(t(entry.descriptionKey)).not.toBe(entry.descriptionKey);
        if (entry.type === "choice") {
          for (const option of entry.options) {
            expect(t(entry.optionLabelKeys[option])).not.toBe(entry.optionLabelKeys[option]);
          }
        }
        if (entry.type === "order") {
          for (const item of entry.items) {
            expect(t(item.labelKey)).not.toBe(item.labelKey);
          }
        }
      }
    }
    setLocale("en");
  });
});
