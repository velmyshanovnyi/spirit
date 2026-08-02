import { isAdvancedModeUnlocked, unlockAdvancedMode, lockAdvancedMode } from "./advancedMode.js";
import { AdminAuthError } from "./adminAuth.js";

/**
 * Section SM2+SM3 (specs/ui/simplified-ephemeral-mode.md): elements that
 * belong to the "advanced" bucket -- hidden by default, restored once
 * unlocked. Call/camera/mic controls (#header-call-controls,
 * #floating-video) are deliberately NOT in this list (user decision
 * 2026-07-31: a call is part of the ephemeral session itself, not
 * messenger-specific functionality).
 *
 * #guest-quick-actions is deliberately NOT here either, even though it IS
 * part of the advanced bucket -- app.js's renderGuestQuickActions() runs at
 * every identity-establishing/clearing point throughout the app's
 * lifetime and would clobber a one-time hide set here. It checks
 * isAdvancedModeUnlocked() itself instead.
 *
 * .settings-wrap (the gear + its dropdown) is ALSO deliberately not in
 * this list (user decision 2026-07-31, follow-up): the gear icon itself
 * stays visible/reachable even while locked, same treatment as call/
 * camera/mic above. This does not defeat the lock -- clicking a nav item
 * inside the dropdown that leads to a restricted route (profile/server/
 * manage/history) still bounces back to "conversation" with SM3's own
 * "розділ вимкнено" notice (router.js's restrictedRoutes gate, untouched
 * by this change); this only avoids hiding the gear's mere presence.
 */
const ADVANCED_ELEMENT_IDS = ["app-sidebar", "btn-sidebar-back"];

export function applyAdvancedModeVisibility(el) {
  const unlocked = isAdvancedModeUnlocked();
  const hide = !unlocked;
  for (const id of ADVANCED_ELEMENT_IDS) {
    const node = el(id);
    if (node) node.hidden = hide;
  }
  return unlocked;
}

export function initAdvancedModeUI({ doc, el, t, onVisibilityChange }) {
  const toggleBtn = el("footer-advanced-toggle");
  const modal = el("advanced-mode-modal");
  const passwordInput = el("advanced-mode-password");
  const errorEl = el("advanced-mode-error");
  const unlockBtn = el("btn-advanced-mode-unlock");
  const cancelBtn = el("btn-advanced-mode-cancel");

  function refreshToggleLabel() {
    if (!toggleBtn) return;
    toggleBtn.textContent = isAdvancedModeUnlocked() ? t("footer.advancedModeLock") : t("footer.advancedModeUnlock");
  }

  applyAdvancedModeVisibility(el);
  refreshToggleLabel();

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isAdvancedModeUnlocked()) {
        // Locking is a UI-cleanliness action, not a security one (per the
        // spec) -- no confirmation needed, matches the "замкнути -- не
        // потребує підтвердження" decision.
        lockAdvancedMode();
        applyAdvancedModeVisibility(el);
        refreshToggleLabel();
        onVisibilityChange?.();
        return;
      }
      if (modal) {
        if (errorEl) errorEl.textContent = "";
        if (passwordInput) passwordInput.value = "";
        modal.hidden = false;
        passwordInput?.focus();
      }
    });
  }

  cancelBtn?.addEventListener("click", () => {
    if (modal) modal.hidden = true;
    // Exec review finding 4 (specs/reviews/simplified-ephemeral-mode-SM2-SM3-iter1.md):
    // don't leave a typed password sitting in the DOM after cancel.
    if (passwordInput) passwordInput.value = "";
  });

  unlockBtn?.addEventListener("click", async () => {
    const baseUrl = el("server-url")?.value;
    const password = passwordInput?.value || "";
    try {
      await unlockAdvancedMode(baseUrl, password);
      if (modal) modal.hidden = true;
      // Exec review finding 4: same "must not linger" invariant this
      // project already enforces for the admin-login form's own password
      // field (app.test.js's admin-panel tests) -- applies here too.
      if (passwordInput) passwordInput.value = "";
      applyAdvancedModeVisibility(el);
      refreshToggleLabel();
      onVisibilityChange?.();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error instanceof AdminAuthError ? t("footer.advancedModeWrongPassword") : t("footer.advancedModeStorageError");
      }
    }
  });

  return { refreshToggleLabel };
}
