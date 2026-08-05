import { adminLogin } from "./adminAuth.js";

const STORAGE_KEY = "spirit.advancedModeUnlocked";

export function isAdvancedModeUnlocked() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // storage unavailable (private mode / blocked third-party storage) --
    // fail closed to the simplified default, same fail-open-to-a-safe-default
    // spirit as theme.js's initTheme.
    return false;
  }
}

/**
 * Section SM1 (specs/ui/simplified-ephemeral-mode.md): reuses the existing
 * admin_login server action PURELY to validate the password -- the returned
 * token is intentionally discarded (user decision 2026-07-31). A successful
 * call is the only proof of a correct password needed; the unlock effect
 * itself is entirely local.
 */
export async function unlockAdvancedMode(baseUrl, password) {
  await adminLogin(baseUrl, password);
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // A storage failure here is NOT a wrong password -- keep it off the
    // AdminAuthError channel SM2 uses to show "invalid password" so the two
    // failure modes never get shown to the user as the same message.
    throw new Error("Advanced mode unlocked, but the browser refused to remember it (storage unavailable).");
  }
  return true;
}

export function lockAdvancedMode() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clean up if storage never worked in the first place
  }
}

/**
 * Section GE1 (specs/ui/granular-feature-flags.md): per-route toggles that
 * live INSIDE the master password unlock above -- these don't grant access
 * on their own, they only let an already-unlocked user narrow it back down
 * again per section. One entry per ADVANCED_ROUTES key (client/js/app.js).
 */
export const ADVANCED_FEATURES = [
  { key: "profile", labelKey: "featureFlags.feature.profile" },
  // "server" deliberately has no labelKey -- it's never rendered as a
  // toggle (see TOGGLEABLE_FEATURE_KEYS below), so there's no i18n key for
  // it in GE3's planned list.
  { key: "server" },
  { key: "room", labelKey: "featureFlags.feature.room" },
  { key: "manage", labelKey: "featureFlags.feature.manage" },
  { key: "history", labelKey: "featureFlags.feature.history" }
];

// "server" is where the granular toggle panel itself lives -- letting its
// own flag disable it would strand the user with no way back short of
// hand-editing localStorage (same self-lockout class as
// footerRegistry.js's "advancedToggle" exclusion). Excluded from the
// toggleable subset entirely; isFeatureEnabled below hard-codes it to
// always-enabled regardless of stored state.
export const TOGGLEABLE_FEATURE_KEYS = ADVANCED_FEATURES.map((f) => f.key).filter((key) => key !== "server");

const FEATURE_FLAGS_KEY = "spirit.advancedFeatureFlags";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFeatureFlags() {
  try {
    const raw = localStorage.getItem(FEATURE_FLAGS_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    // Parse error, wrong shape, or storage unavailable -- all fall back to
    // "nothing stored", which isFeatureEnabled below treats as "enabled".
    return {};
  }
}

export function isFeatureEnabled(key) {
  if (key === "server") return true;
  const stored = readFeatureFlags();
  return stored[key] !== false;
}

export function setFeatureEnabled(key, enabled) {
  if (key === "server") return; // no-op: see TOGGLEABLE_FEATURE_KEYS comment above
  const stored = readFeatureFlags();
  stored[key] = enabled;
  try {
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(stored));
  } catch {
    // Best-effort persistence, same as footerRegistry.js's writeJSON --
    // a full/unavailable localStorage just means this doesn't stick.
  }
}

export function resetFeatureFlags() {
  try {
    localStorage.removeItem(FEATURE_FLAGS_KEY);
  } catch {
    // nothing to clean up if storage never worked in the first place
  }
}
