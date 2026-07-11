// Session memory (Section 18, specs/phase2/onboarding-auth.md): remembers
// WHICH profile was last active and for how long, so the login screen can
// preselect it -- passphrase is still required every load, since the
// vaultKey itself is never persisted (only the profile id + an expiry).
const SESSION_STORAGE_KEY = "spirit.session";

export function rememberSession(profileId, ttlHours) {
  const expiresAt = Date.now() + ttlHours * 3600 * 1000;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ profileId, expiresAt }));
}

export function getRememberedProfileId(now = Date.now()) {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
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
