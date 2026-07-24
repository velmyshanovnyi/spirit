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

export const DESIGN_SETTINGS = [
  {
    key: "accentColor",
    category: "colors",
    label: "Акцентний колір",
    description: "Колір кнопок, посилань та активних елементів по всьому інтерфейсу.",
    type: "color",
    cssVar: "--accent"
  },
  {
    key: "backgroundColor",
    category: "colors",
    label: "Колір фону сторінки",
    description: "Основний фоновий колір за картками та панелями.",
    type: "color",
    cssVar: "--bg"
  },
  {
    key: "cardBackgroundColor",
    category: "colors",
    label: "Колір фону карток",
    description: "Фон карток, шапки сайту та бічної панелі.",
    type: "color",
    cssVar: "--card-bg"
  },
  {
    key: "textColor",
    category: "colors",
    label: "Колір основного тексту",
    description: "Колір звичайного тексту -- заголовків, підписів, повідомлень у чаті.",
    type: "color",
    cssVar: "--text"
  },
  {
    key: "mutedTextColor",
    category: "colors",
    label: "Колір приглушеного тексту",
    description: "Колір другорядного тексту -- підказок, часток, статусів.",
    type: "color",
    cssVar: "--muted"
  },
  {
    key: "borderColor",
    category: "colors",
    label: "Колір рамок",
    description: "Колір розділових ліній і рамок навколо полів/карток.",
    type: "color",
    cssVar: "--border"
  },
  {
    key: "cornerRadius",
    category: "shape",
    label: "Округлення карток (px)",
    description: "Радіус заокруглення великих елементів -- карток, модальних вікон.",
    type: "length",
    cssVar: "--radius",
    min: 0,
    max: 32
  },
  {
    key: "cornerRadiusSmall",
    category: "shape",
    label: "Округлення кнопок і полів (px)",
    description: "Радіус заокруглення дрібніших елементів -- кнопок, полів вводу, бейджів.",
    type: "length",
    cssVar: "--radius-sm",
    min: 0,
    max: 24
  },
  {
    key: "fontFamily",
    category: "typography",
    label: "Шрифт інтерфейсу",
    description: "CSS-стек шрифтів (через кому), яким набирається весь текст інтерфейсу.",
    type: "text",
    cssVar: "--font-family"
  },
  {
    key: "fontSizeBase",
    category: "typography",
    label: "Базовий розмір шрифту (px)",
    description: "Базовий розмір тексту, від якого відносно масштабуються заголовки й дрібніші елементи.",
    type: "length",
    cssVar: "--font-size-base",
    min: 11,
    max: 22
  },
  {
    key: "contentMaxWidth",
    category: "layout",
    label: "Максимальна ширина сторінки (px)",
    description: "На широких екранах увесь вміст (шапка, сайдбар, основна панель) центрується в межах цієї ширини замість розтягування на весь монітор.",
    type: "length",
    cssVar: "--content-max-width",
    min: 800,
    max: 2400
  },
  {
    key: "sidebarWidth",
    category: "layout",
    label: "Ширина бічної панелі (px)",
    description: "Ширина сайдбара з чатами й папками зліва. Занадто мале значення може обрізати текст у списку контактів.",
    type: "length",
    cssVar: "--sidebar-width",
    min: 200,
    max: 500
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
    if (value === null) {
      root.style.removeProperty(entry.cssVar);
      continue;
    }
    const cssValue = entry.type === "length" ? `${value}px` : value;
    root.style.setProperty(entry.cssVar, cssValue);
  }
}
