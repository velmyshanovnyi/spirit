const THEME_STORAGE_KEY = "spirit.theme";

function apply(doc, theme) {
  doc.documentElement.dataset.theme = theme;
}

/**
 * Resolution order: explicit user choice (localStorage) -> OS preference
 * (prefers-color-scheme) -> light.
 */
export function initTheme(doc) {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // storage unavailable -- fall through to the OS preference
  }
  if (stored === "light" || stored === "dark") {
    apply(doc, stored);
    return;
  }
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  apply(doc, prefersDark ? "dark" : "light");
}

export function toggleTheme(doc) {
  const next = doc.documentElement.dataset.theme === "dark" ? "light" : "dark";
  apply(doc, next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // session-only toggle is fine
  }
}
