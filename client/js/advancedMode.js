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
