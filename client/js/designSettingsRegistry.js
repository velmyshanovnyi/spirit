/**
 * Section RF14 (specs/ui/settings-panel.md's design-settings extension):
 * user-tunable DESIGN tokens -- colors, corner radius, typography -- as
 * opposed to settingsRegistry.js's behavioral/timing parameters.
 *
 * Unlike settingsRegistry.js, a design setting's "default" is NOT a fixed
 * baked-in value -- colors differ between light/dark theme, so "default"
 * means "no override, let the stylesheet's :root[data-theme=...] rule for
 * whichever theme is currently active decide". getDesignSetting(key)
 * returns the stored override or `null` (never a fallback value); the
 * settings UI reads the CURRENT computed value from getComputedStyle for
 * display, and applyDesignSettings() removes the inline override entirely
 * when there isn't one, so switching themes or resetting always shows the
 * real stylesheet value for whichever theme is active.
 */

const STORAGE_PREFIX = "spirit.designSettings.";

// Section C6 (specs/reviews/spirit-evaluation-triage.md): same fix as
// settingsRegistry.js -- label/description/optionLabels/item.label used to
// be hardcoded Ukrainian literals. Every entry now carries labelKey/
// descriptionKey (and choice entries optionLabelKeys, order items
// labelKey) pointing into i18n.js's MESSAGES
// (designSettings.<key>.label / .description; choice options share
// designSettings.side.left/right rather than a per-key option key, since
// every current choice entry is a left/right toggle), resolved via t() in
// renderDesignSettings() in app.js.
export const DESIGN_SETTINGS = [
  {
    key: "accentColor",
    category: "colors",
    labelKey: "designSettings.accentColor.label",
    descriptionKey: "designSettings.accentColor.description",
    type: "color",
    cssVar: "--accent"
  },
  {
    key: "backgroundColor",
    category: "colors",
    labelKey: "designSettings.backgroundColor.label",
    descriptionKey: "designSettings.backgroundColor.description",
    type: "color",
    cssVar: "--bg"
  },
  {
    key: "cardBackgroundColor",
    category: "colors",
    labelKey: "designSettings.cardBackgroundColor.label",
    descriptionKey: "designSettings.cardBackgroundColor.description",
    type: "color",
    cssVar: "--card-bg"
  },
  {
    key: "textColor",
    category: "colors",
    labelKey: "designSettings.textColor.label",
    descriptionKey: "designSettings.textColor.description",
    type: "color",
    cssVar: "--text"
  },
  {
    key: "mutedTextColor",
    category: "colors",
    labelKey: "designSettings.mutedTextColor.label",
    descriptionKey: "designSettings.mutedTextColor.description",
    type: "color",
    cssVar: "--muted"
  },
  {
    key: "borderColor",
    category: "colors",
    labelKey: "designSettings.borderColor.label",
    descriptionKey: "designSettings.borderColor.description",
    type: "color",
    cssVar: "--border"
  },
  {
    key: "cornerRadius",
    category: "shape",
    labelKey: "designSettings.cornerRadius.label",
    descriptionKey: "designSettings.cornerRadius.description",
    type: "length",
    cssVar: "--radius",
    min: 0,
    max: 32
  },
  {
    key: "cornerRadiusSmall",
    category: "shape",
    labelKey: "designSettings.cornerRadiusSmall.label",
    descriptionKey: "designSettings.cornerRadiusSmall.description",
    type: "length",
    cssVar: "--radius-sm",
    min: 0,
    max: 24
  },
  {
    key: "fontFamily",
    category: "typography",
    labelKey: "designSettings.fontFamily.label",
    descriptionKey: "designSettings.fontFamily.description",
    type: "text",
    cssVar: "--font-family"
  },
  {
    key: "fontSizeBase",
    category: "typography",
    labelKey: "designSettings.fontSizeBase.label",
    descriptionKey: "designSettings.fontSizeBase.description",
    type: "length",
    cssVar: "--font-size-base",
    min: 11,
    max: 22
  },
  {
    key: "contentMaxWidth",
    category: "layout",
    labelKey: "designSettings.contentMaxWidth.label",
    descriptionKey: "designSettings.contentMaxWidth.description",
    type: "length",
    cssVar: "--content-max-width",
    min: 800,
    max: 2400
  },
  {
    key: "sidebarWidth",
    category: "layout",
    labelKey: "designSettings.sidebarWidth.label",
    descriptionKey: "designSettings.sidebarWidth.description",
    type: "length",
    cssVar: "--sidebar-width",
    min: 200,
    max: 500
  },
  {
    // Section RF22 (specs/ui/design-edit-mode.md, Stage 2): the
    // conversation card's width was previously a HARDCODED 1100px on
    // .layout (client/css/style.css) -- default here matches that exact
    // value, so leaving this unset changes nothing for existing users.
    key: "conversationWidth",
    category: "layout",
    labelKey: "designSettings.conversationWidth.label",
    descriptionKey: "designSettings.conversationWidth.description",
    type: "length",
    cssVar: "--conversation-width",
    min: 600,
    max: 1600
  },
  {
    // Section RF23 (specs/ui/design-edit-mode.md, Stage 2): where the SM3
    // "розділ вимкнено" toast (#advanced-mode-notice) appears -- default
    // "bottom-center" matches the pre-existing hardcoded position exactly
    // (client/css/style.css), so leaving this unset changes nothing.
    key: "noticePosition",
    category: "layout",
    labelKey: "designSettings.noticePosition.label",
    descriptionKey: "designSettings.noticePosition.description",
    type: "choice",
    // Exec review finding 1 (specs/reviews/design-edit-mode-RF23-iter1.md):
    // options[0] must be the actual stylesheet default (settingsPanelUI.js's
    // renderDesignSettings relies on this exact invariant -- "stored ??
    // entry.options[0]" -- to highlight the active chip when nothing is
    // stored). CSS's unconditional base rule is bottom-center, so it MUST
    // be first here, not just alphabetically/reading-order first.
    options: ["bottom-center", "top-left", "top-center", "top-right", "bottom-left", "bottom-right"],
    optionLabelKeys: {
      "top-left": "designSettings.position.topLeft",
      "top-center": "designSettings.position.topCenter",
      "top-right": "designSettings.position.topRight",
      "bottom-left": "designSettings.position.bottomLeft",
      "bottom-center": "designSettings.position.bottomCenter",
      "bottom-right": "designSettings.position.bottomRight"
    },
    rootAttribute: "noticePosition"
  },
  {
    // Section RF21 (specs/ui/design-edit-mode.md, Stage 2): float
    // (default, RF4's original draggable/resizable overlay) vs docked
    // (rendered inline inside the conversation card, no drag/resize).
    // "float" MUST be options[0] -- settingsPanelUI.js's choice renderer
    // highlights options[0] as active when nothing is stored, and CSS's
    // unconditional default IS float (same invariant RF23 needed).
    key: "videoMode",
    category: "layout",
    labelKey: "designSettings.videoMode.label",
    descriptionKey: "designSettings.videoMode.description",
    type: "choice",
    options: ["float", "docked"],
    optionLabelKeys: { float: "designSettings.video.float", docked: "designSettings.video.docked" },
    rootAttribute: "videoMode"
  },
  {
    key: "sidebarSide",
    category: "layout",
    labelKey: "designSettings.sidebarSide.label",
    descriptionKey: "designSettings.sidebarSide.description",
    type: "choice",
    options: ["left", "right"],
    optionLabelKeys: { left: "designSettings.side.left", right: "designSettings.side.right" },
    rootAttribute: "sidebarSide"
  },
  {
    key: "toolbarSide",
    category: "layout",
    labelKey: "designSettings.toolbarSide.label",
    descriptionKey: "designSettings.toolbarSide.description",
    type: "choice",
    options: ["left", "right"],
    optionLabelKeys: { left: "designSettings.side.left", right: "designSettings.side.right" },
    rootAttribute: "toolbarSide"
  },
  {
    key: "headerControlsOrder",
    category: "layout",
    labelKey: "designSettings.headerControlsOrder.label",
    descriptionKey: "designSettings.headerControlsOrder.description",
    type: "order",
    // Array order here IS the stylesheet default -- matches client/index.html's
    // actual DOM order for these elements exactly, so "no override" naturally
    // renders identically to this list, no special-casing needed on reset.
    items: [
      { key: "headerCallControls", labelKey: "designSettings.headerControlsOrder.item.headerCallControls", selector: "#header-call-controls" },
      { key: "langSelect", labelKey: "designSettings.headerControlsOrder.item.langSelect", selector: "#lang-select" },
      { key: "themeToggle", labelKey: "designSettings.headerControlsOrder.item.themeToggle", selector: "#theme-toggle" },
      { key: "settingsGear", labelKey: "designSettings.headerControlsOrder.item.settingsGear", selector: ".settings-wrap" }
    ]
  },
  {
    key: "callControls",
    category: "visibility",
    labelKey: "designSettings.callControls.label",
    descriptionKey: "designSettings.callControls.description",
    type: "boolean",
    selector: "#header-call-controls"
  },
  {
    key: "sidebarSearch",
    category: "visibility",
    labelKey: "designSettings.sidebarSearch.label",
    descriptionKey: "designSettings.sidebarSearch.description",
    type: "boolean",
    selector: ".sidebar-search"
  },
  {
    key: "sidebarFilters",
    category: "visibility",
    labelKey: "designSettings.sidebarFilters.label",
    descriptionKey: "designSettings.sidebarFilters.description",
    type: "boolean",
    selector: ".sidebar-filters"
  },
  {
    key: "folderTree",
    category: "visibility",
    labelKey: "designSettings.folderTree.label",
    descriptionKey: "designSettings.folderTree.description",
    type: "boolean",
    selector: "#folder-tree"
  },
  {
    key: "proofsCheckBlock",
    category: "visibility",
    labelKey: "designSettings.proofsCheckBlock.label",
    descriptionKey: "designSettings.proofsCheckBlock.description",
    type: "boolean",
    selector: "#proofs-check-block"
  }
];

const DESIGN_SETTINGS_BY_KEY = new Map(DESIGN_SETTINGS.map((entry) => [entry.key, entry]));

/** Returns the stored override for `key`, or null if unset (== use the stylesheet default). */
export function getDesignSetting(key) {
  const def = DESIGN_SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`designSettingsRegistry: unknown setting "${key}"`);
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    if (def.type === "length") {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < def.min || parsed > def.max) return null;
      return parsed;
    }
    if (def.type === "boolean") return raw === "1";
    if (def.type === "choice") return def.options.includes(raw) ? raw : null;
    if (def.type === "order") {
      const parsed = JSON.parse(raw);
      const validKeys = def.items.map((item) => item.key);
      if (!Array.isArray(parsed) || parsed.length !== validKeys.length) return null;
      if (!validKeys.every((k) => parsed.includes(k))) return null;
      return parsed;
    }
    return raw;
  } catch {
    return null;
  }
}

/** Validates and persists `value` as an override for `key`. Returns false (no-op) if invalid. */
export function setDesignSetting(key, value) {
  const def = DESIGN_SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`designSettingsRegistry: unknown setting "${key}"`);
  let toStore = value;
  if (def.type === "color" && !/^#[0-9a-fA-F]{6}$/.test(value)) return false;
  if (def.type === "length") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < def.min || parsed > def.max) return false;
    toStore = parsed;
  }
  if (def.type === "text" && (typeof value !== "string" || value.trim() === "")) return false;
  if (def.type === "boolean") toStore = value ? "1" : "0";
  if (def.type === "choice" && !def.options.includes(value)) return false;
  if (def.type === "order") {
    const validKeys = def.items.map((item) => item.key);
    if (!Array.isArray(value) || value.length !== validKeys.length || !validKeys.every((k) => value.includes(k))) {
      return false;
    }
    toStore = JSON.stringify(value);
  }
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(toStore));
  } catch {
    // Best-effort only -- a full/unavailable localStorage just means this
    // override doesn't persist across reloads, not a functional break.
  }
  return true;
}

/** Removes the override for `key`, reverting it to the stylesheet's own value. */
export function resetDesignSetting(key) {
  if (!DESIGN_SETTINGS_BY_KEY.has(key)) throw new Error(`designSettingsRegistry: unknown setting "${key}"`);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Best-effort, same reasoning as setDesignSetting.
  }
}

/** Resets every registered design setting back to the stylesheet default. */
export function resetAllDesignSettings() {
  for (const entry of DESIGN_SETTINGS) resetDesignSetting(entry.key);
}

/**
 * Applies every stored override (or removes it if unset) as an inline
 * style on :root -- inline style always wins over the stylesheet's own
 * :root[data-theme=...] rule regardless of specificity tricks, and
 * removeProperty cleanly falls back to whichever theme is active. Call
 * once at startup and again after any change so the page reflects the
 * current overrides immediately, no reload required.
 */
export function applyDesignSettings(doc = document) {
  const root = doc.documentElement;
  for (const entry of DESIGN_SETTINGS) {
    const value = getDesignSetting(entry.key);
    if (entry.type === "boolean") {
      for (const node of doc.querySelectorAll(entry.selector)) {
        node.style.display = value === false ? "none" : "";
      }
      continue;
    }
    if (entry.type === "choice") {
      if (value === null) {
        delete root.dataset[entry.rootAttribute];
      } else {
        root.dataset[entry.rootAttribute] = value;
      }
      continue;
    }
    if (entry.type === "order") {
      if (value === null) {
        for (const item of entry.items) {
          for (const node of doc.querySelectorAll(item.selector)) {
            node.style.removeProperty("order");
          }
        }
      } else {
        value.forEach((itemKey, index) => {
          const item = entry.items.find((i) => i.key === itemKey);
          if (!item) return;
          for (const node of doc.querySelectorAll(item.selector)) {
            node.style.order = String(index);
          }
        });
      }
      continue;
    }
    if (value === null) {
      root.style.removeProperty(entry.cssVar);
      continue;
    }
    const cssValue = entry.type === "length" ? `${value}px` : value;
    root.style.setProperty(entry.cssVar, cssValue);
  }
}
