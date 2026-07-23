// Session memory (Section 18, specs/phase2/onboarding-auth.md): remembers
// WHICH profile was last active and for how long, so the login screen can
// preselect it -- passphrase is still required every load, since the
// vaultKey itself is never persisted (only the profile id + an expiry).
import { getSetting } from "./settingsRegistry.js";

const SESSION_STORAGE_KEY = "spirit.session";

export function rememberSession(profileId, ttlHours) {
  const expiresAt = Date.now() + ttlHours * 3600 * 1000;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ profileId, expiresAt }));
}

export function getRememberedProfileId(now = Date.now()) {
  let raw;
  try {
    raw = localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage access can throw (private-mode/blocked site data) -- exec
    // review finding (Section H5): this is called unguarded from a
    // production-only code path (initApp's zero-click auto-start), where an
    // uncaught throw here would take down the whole app's boot.
    return null;
  }
  if (!raw) return null;
  try {
    const { profileId, expiresAt } = JSON.parse(raw);
    if (typeof expiresAt !== "number" || now >= expiresAt) return null;
    return profileId ?? null;
  } catch {
    return null;
  }
}

export function forgetSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

// Browser-wide "recently used accounts" (not tied to one origin's IndexedDB
// profile store) -- the login screen offers these first so the list can't
// grow unboundedly on a shared/public machine. Most-recent-first, capped.
const RECENT_ACCOUNTS_KEY = "spirit.recentAccounts";

export function recordRecentAccount(profileId) {
  const current = getRecentAccounts().filter((id) => id !== profileId);
  const updated = [profileId, ...current].slice(0, getSetting("maxRecentAccounts"));
  localStorage.setItem(RECENT_ACCOUNTS_KEY, JSON.stringify(updated));
}

export function getRecentAccounts() {
  const raw = localStorage.getItem(RECENT_ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
