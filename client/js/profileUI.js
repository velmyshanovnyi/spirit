// Section R7 (specs/phase5/app-decomposition.md, backlog A4): profile /
// account handlers -- the login selector (MRU-ordered, remembered-session
// preselect), create/login mode switch, portable (cross-node) login, unlock,
// create (random or deterministic/portable), mnemonic/keyfile backup and the
// backup-skip step -- extracted verbatim out of app.js's initApp() closure,
// continuing the G1/R1-R6 dependency-injection pattern. `state` is the same
// mutable object app.js holds. `renderRecoveryCard` and `navigate` arrive as
// lazy thunks: they wrap consts created later in initApp than this module is
// initialized (recoveryUI, router), and are only ever invoked from click
// handlers, after initApp completed. app.js consumes refreshProfileSelector.
import { exportPrivateKeyScalar, exportPrivateKeyRaw, fingerprint } from "./identity.js";
import { createPermanentProfile, listProfiles, loadPermanentProfile, setNickname, getNickname, adoptScalarIdentity } from "./profile.js";
import { deriveAccountMaterial, generateAccountName } from "./deterministicIdentity.js";
import { generateStrongPassword } from "./passwordGenerator.js";
import { bytesToMnemonic } from "./mnemonic.js";
import { createKeyfile } from "./keyfile.js";
import { formatSpiritId } from "./spiritId.js";
import { rememberSession, getRememberedProfileId, recordRecentAccount, getRecentAccounts } from "./session.js";

export function initProfileUI({
  doc, el, t, state, withBusyButton, setDynamicText,
  resetOwnProofsState, renderGuestQuickActions, renderNotificationsCard, renderRecoveryCard,
  readSessionTtlHours, postIdentityRoute, navigate
}) {
  const setProfileStatus = (text) => {
    el("profile-status").textContent = text;
  };

  el("btn-create-profile").addEventListener("click", () => {
    el("profile-setup").hidden = false;
  });

  // Section H3: offer a generated password by default when the user opts
  // into a portable account, without clobbering anything they've already
  // typed (e.g. re-checking the box after editing the field).
  el("portable-account-checkbox").addEventListener("change", async () => {
    if (el("portable-account-checkbox").checked && !el("profile-passphrase").value) {
      el("profile-passphrase").value = await generateStrongPassword();
    }
  });

  // Section 17/18: a returning user (stored profiles exist) sees the login
  // block instead of the create-account flow; a remembered, not-yet-expired
  // session preselects which profile so they only need to type the
  // passphrase -- the passphrase itself is never skipped or persisted.
  async function refreshProfileSelector() {
    const select = el("profile-select");
    select.innerHTML = "";
    const profiles = await listProfiles();
    // Browser-wide MRU list (Section G1) -- recently used accounts first,
    // capped at 10 total so the list can't grow unboundedly on a
    // shared/public machine; anything beyond that still exists in storage,
    // it's just not offered here until it's used again some other way.
    const recentIds = getRecentAccounts();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const ordered = [
      ...recentIds.map((id) => byId.get(id)).filter(Boolean),
      ...profiles.filter((p) => !recentIds.includes(p.id))
    ].slice(0, 10);
    for (const { id } of ordered) {
      const option = doc.createElement("option");
      option.value = id;
      option.textContent = id === "identity" ? t("profile.legacyOption") : formatSpiritId(id).slice(0, 26) + "…";
      select.appendChild(option);
    }
    // Hide once an identity is already active this session (e.g. right
    // after creating a profile) -- there's nothing to log into anymore.
    // Create/login are mutually exclusive (Section F2) -- one always shows
    // when the other is hidden, defaulting to login for a returning user.
    el("account-login-block").hidden = profiles.length === 0 || !!state.senderKey;
    el("account-create-mode").hidden = !el("account-login-block").hidden;
    const remembered = getRememberedProfileId();
    if (remembered && profiles.some((p) => p.id === remembered)) {
      select.value = remembered;
    }
  }
  // Fire-and-forget at startup; an empty selector is the correct state on error too.
  refreshProfileSelector().catch(() => {});

  // Section F2: manual override of the default create/login mode -- e.g. a
  // returning user (default: login) wants to create ANOTHER account, or
  // vice versa.
  el("link-switch-to-login").addEventListener("click", () => {
    el("account-login-block").hidden = false;
    el("account-create-mode").hidden = true;
  });
  el("link-switch-to-create").addEventListener("click", () => {
    el("account-create-mode").hidden = false;
    el("account-login-block").hidden = true;
  });

  // Section H4 (specs/ui/deterministic-accounts.md): cross-node login --
  // available regardless of whether this browser has any local profile
  // record for this account (that's the entire point: it works on a node
  // that has NEVER seen this account before).
  const setPortableLoginStatus = (text) => {
    el("portable-login-status").textContent = text;
  };
  el("link-toggle-portable-login").addEventListener("click", () => {
    el("portable-login-form").hidden = !el("portable-login-form").hidden;
  });
  const PORTABLE_LOGIN_PATTERN = /^spirit([a-z0-9]{10})([A-Za-z0-9_-]{16})$/;
  withBusyButton(el("btn-login-portable"), async () => {
    const login = el("portable-login-input").value.trim();
    const password = el("portable-password-input").value;
    const match = PORTABLE_LOGIN_PATTERN.exec(login);
    if (!match) {
      setPortableLoginStatus(t("portable.invalidLogin"));
      return;
    }
    const [, name, expectedTail] = match;
    const { privateKeyScalar, verifierTail } = await deriveAccountMaterial(name, password);
    if (verifierTail !== expectedTail) {
      setPortableLoginStatus(t("portable.wrongCredentials"));
      return;
    }
    state.identityKeyPair = await adoptScalarIdentity(privateKeyScalar, password);
    state.senderKey = state.identityKeyPair.profileId;
    // Exec review: every other identity-establishing path loads the
    // account's own nickname -- skipping this would leak a STALE nickname
    // (e.g. a prior ephemeral quick-chat one) to peers on the next
    // identity-announce, under a completely different identity.
    state.nickname = await getNickname(state.senderKey);
    el("portable-password-input").value = "";
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    setPortableLoginStatus("");
    // Exec review: same session/MRU bookkeeping as the regular unlock path,
    // so this account is offered via profile-select on a later visit too.
    rememberSession(state.senderKey, readSessionTtlHours());
    recordRecentAccount(state.senderKey);
    await refreshProfileSelector();
    navigate(postIdentityRoute());
  });


  withBusyButton(el("btn-profile-unlock"), async () => {
    const passphrase = el("unlock-passphrase").value;
    if (!passphrase) {
      setProfileStatus(t("unlock.needPassphrase"));
      return;
    }
    const selectedId = el("profile-select").value;
    if (!selectedId) {
      setProfileStatus(t("unlock.noProfiles"));
      return;
    }
    try {
      const profile = await loadPermanentProfile(selectedId, passphrase);
      el("unlock-passphrase").value = "";
      state.identityKeyPair = profile;
      state.senderKey = profile.profileId;
      state.nickname = await getNickname(state.senderKey);
      resetOwnProofsState();
      renderGuestQuickActions();
      renderNotificationsCard();
    renderRecoveryCard();
      setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
      setProfileStatus("");
      // A legacy record migrates on unlock -- its id changes to the
      // fingerprint (profile.profileId), which is what must be remembered,
      // not the pre-migration `selectedId` ("identity") -- otherwise the
      // remembered id never matches on the next load's listProfiles().
      rememberSession(profile.profileId, readSessionTtlHours());
      recordRecentAccount(profile.profileId);
      await refreshProfileSelector();
      navigate(postIdentityRoute());
    } catch (err) {
      setProfileStatus(err.message);
    }
  });

  withBusyButton(el("btn-profile-confirm"), async () => {
    const passphrase = el("profile-passphrase").value;
    if (!passphrase) {
      setProfileStatus(t("profile.needPassphrase"));
      return;
    }
    // Section H3 (specs/phase3/deterministic-accounts.md): opt-in portable
    // account -- identity is derived from (name, password) via Argon2id
    // instead of generated at random, so the SAME account can be recreated
    // on any independent node (Section H4). Default (unchecked) path below
    // is completely unchanged -- existing local-only accounts still work
    // exactly as before.
    if (el("portable-account-checkbox").checked) {
      const name = generateAccountName();
      const { privateKeyScalar, verifierTail } = await deriveAccountMaterial(name, passphrase);
      state.identityKeyPair = await adoptScalarIdentity(privateKeyScalar, passphrase);
      state.senderKey = state.identityKeyPair.profileId;
      el("portable-login-display").textContent = `spirit${name}${verifierTail}`;
    } else {
      state.identityKeyPair = await createPermanentProfile(passphrase);
      state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    }
    // Don't keep the secret sitting in a DOM input after it's been used.
    el("profile-passphrase").value = "";
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    const nickname = el("nickname-input").value.trim();
    if (nickname) {
      await setNickname(state.senderKey, nickname);
      state.nickname = nickname;
    }
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    setProfileStatus("");
    el("backup-step").hidden = false;
    await refreshProfileSelector();
  });

  withBusyButton(el("btn-backup-mnemonic"), async () => {
    const scalar = await exportPrivateKeyScalar(state.identityKeyPair.privateKey);
    const words = await bytesToMnemonic(scalar);
    el("mnemonic-display").textContent = words.join(" ");
  });

  withBusyButton(el("btn-backup-keyfile"), async () => {
    const keyfilePassphrase = el("keyfile-passphrase").value;
    if (!keyfilePassphrase) {
      setProfileStatus(t("profile.needKeyfilePassphrase"));
      return;
    }
    const rawPrivateKey = await exportPrivateKeyRaw(state.identityKeyPair.privateKey);
    const keyfile = await createKeyfile(rawPrivateKey, keyfilePassphrase);
    el("keyfile-passphrase").value = "";
    el("keyfile-display").textContent = JSON.stringify(keyfile);
  });

  el("btn-backup-skip").addEventListener("click", () => {
    el("backup-step").hidden = true;
    el("backup-reminder").hidden = false;
    // Onboarding (account screen) is done. Usually that means profile
    // administration; an invite-link visitor instead goes straight to the
    // room screen, where Room ID/token are already pre-filled.
    navigate(postIdentityRoute());
  });

  return { refreshProfileSelector };
}
