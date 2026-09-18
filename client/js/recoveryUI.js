// Section R1 (specs/phase5/app-decomposition.md, backlog A4): the social-
// recovery domain extracted out of app.js's initApp() closure, continuing
// the G1 dependency-injection pattern (see deviceLinkingUI.js). Three
// cohesive blocks moved verbatim: the recovery card (Shamir setup, held
// shares), the per-contact share outbox, and restore-from-shares. `state`
// is the same mutable object app.js holds (passed by reference); `navigate`
// is a lazy thunk over app.js's router (created later in initApp than this
// module is initialized -- a direct reference would hit the const TDZ).
// Only the two returned functions are consumed by app.js; everything else
// is internal.
import { importPrivateKeyRaw, exportPrivateKeyScalar } from "./identity.js";
import { exportRawIdentity, getNickname, adoptScalarIdentity } from "./profile.js";
import { get, put } from "./db.js";
import { splitSecret } from "./shamir.js";
import { buildRecoveryShareAnnounce, encodeShareAsText } from "./recoveryShare.js";
import { listTrustedShares, getTrustedShare } from "./trustedShares.js";
import { qrSvgMarkup } from "./qr.js";
import { recoverFromShares } from "./socialRecovery.js";
import { encryptMessage } from "./e2ee.js";
import { formatSpiritId } from "./spiritId.js";
import { listContacts } from "./contacts.js";
import { rememberSession, recordRecentAccount } from "./session.js";

export function initRecoveryUI({
  doc,
  el,
  t,
  state,
  withBusyButton,
  setDynamicText,
  resetOwnProofsState,
  renderGuestQuickActions,
  renderNotificationsCard,
  refreshProfileSelector,
  readSessionTtlHours,
  postIdentityRoute,
  navigate
}) {
  // Section S2 (specs/phase5/social-recovery.md): same visibility gate as
  // renderNotificationsCard -- social recovery only makes sense for a
  // permanent profile (there is an identity worth protecting, and a vault
  // to re-derive the raw scalar from via the passphrase). Renders the list
  // of verified contacts as checkboxes (min 2 selectable), a threshold
  // <select> defaulting to "majority" (Math.ceil((N+1)/2)), and the list of
  // shares this device currently holds on behalf of OTHER people.
  async function renderRecoveryCard() {
    const card = el("recovery-card");
    if (!card) return;
    const isPermanentProfile = !!(state.identityKeyPair && state.identityKeyPair.vaultKey);
    card.hidden = !isPermanentProfile;
    if (!isPermanentProfile) return;

    const list = el("recovery-contacts-list");
    if (list) {
      const contacts = await listContacts();
      list.innerHTML = "";
      for (const contact of contacts) {
        const row = doc.createElement("label");
        row.className = "field checkbox-field";
        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.recoveryContactFingerprint = contact.fingerprint;
        const span = doc.createElement("span");
        span.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
        row.appendChild(checkbox);
        row.appendChild(span);
        list.appendChild(row);
      }
    }
    renderRecoveryThresholdOptions();

    const heldList = el("recovery-held-list");
    if (heldList) {
      const held = await listTrustedShares();
      heldList.innerHTML = "";
      if (held.length === 0) {
        const empty = doc.createElement("p");
        empty.className = "hint";
        empty.textContent = t("recovery.noHeldShares");
        heldList.appendChild(empty);
      }
      for (const share of held) {
        const row = doc.createElement("div");
        row.className = "list-row";
        const label = doc.createElement("span");
        label.textContent = t("recovery.heldFor", { fp: formatSpiritId(share.ownerFingerprint) });
        row.appendChild(label);
        // Section S3: trustee-side "view/export a held share" -- read-only
        // reveal of ALREADY-STORED data via the same encodeShareAsText used
        // by the owner-side setup export (Section S2). No extra
        // re-authentication gate here (exec-review judgment call, Section
        // S3): a single share below `threshold` is information-theoretically
        // useless on its own (Shamir's guarantee, shamir.js), so showing it
        // to whoever is already using this unlocked device/session reveals
        // nothing exploitable alone -- unlike revealing a full mnemonic or
        // keyfile passphrase, which by itself reconstructs the entire key.
        const showButton = doc.createElement("button");
        showButton.type = "button";
        showButton.textContent = t("recovery.showAsText");
        showButton.dataset.showHeldShareFor = share.ownerFingerprint;
        row.appendChild(showButton);
        heldList.appendChild(row);
      }
    }
  }

  el("recovery-held-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-show-held-share-for]");
    if (!button) return;
    const ownerFingerprint = button.dataset.showHeldShareFor;
    const share = await getTrustedShare(ownerFingerprint);
    const textEl = el("recovery-held-share-text");
    if (!textEl || !share) return;
    textEl.hidden = false;
    const shareText = encodeShareAsText(share);
    textEl.textContent = shareText;
    const qrEl = el("recovery-held-share-qr");
    if (qrEl) {
      qrEl.hidden = false;
      qrEl.innerHTML = await qrSvgMarkup(shareText);
    }
  });

  /**
   * Rebuilds the threshold <select>'s options for the CURRENTLY checked
   * contact count N ([2, N]), keeping the "majority" default
   * (Math.ceil((N+1)/2), Section S2 decision) selected unless the user
   * already picked a different value that's still valid for the new N.
   */
  function renderRecoveryThresholdOptions() {
    const select = el("recovery-threshold");
    if (!select) return;
    const n = doc.querySelectorAll("[data-recovery-contact-fingerprint]:checked").length;
    const previous = select.value ? Number(select.value) : null;
    select.innerHTML = "";
    if (n < 2) return;
    const defaultThreshold = Math.ceil((n + 1) / 2);
    for (let k = 2; k <= n; k++) {
      const option = doc.createElement("option");
      option.value = String(k);
      option.textContent = `${k} / ${n}`;
      select.appendChild(option);
    }
    select.value = String(previous && previous >= 2 && previous <= n ? previous : defaultThreshold);
  }
  el("recovery-contacts-list")?.addEventListener("change", renderRecoveryThresholdOptions);

  const setRecoveryStatus = (text) => {
    const status = el("recovery-status");
    if (status) status.textContent = text;
  };

  // el("btn-setup-recovery") may be absent (older/minimal test fixtures that
  // don't include the recovery card markup) -- guard like the other
  // optional-element listeners in this file (e.g. notifications-enabled)
  // rather than assuming withBusyButton's non-null button.
  if (el("btn-setup-recovery")) withBusyButton(el("btn-setup-recovery"), async () => {
    const selected = [...doc.querySelectorAll("[data-recovery-contact-fingerprint]:checked")].map(
      (checkbox) => checkbox.dataset.recoveryContactFingerprint
    );
    if (selected.length < 2) {
      setRecoveryStatus(t("recovery.needTwoContacts"));
      return;
    }
    const threshold = Number(el("recovery-threshold").value);
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > selected.length) {
      setRecoveryStatus(t("recovery.badThreshold"));
      return;
    }
    const passphrase = el("recovery-setup-passphrase").value;
    if (!passphrase) {
      setRecoveryStatus(t("unlock.needPassphrase"));
      return;
    }
    if (!state.senderKey) {
      setRecoveryStatus(t("status.createAccountFirst"));
      return;
    }

    // Re-deriving the raw identity from the vault (same pattern as
    // btn-link-device) is REQUIRED here: a logged-in permanent profile's
    // state.identityKeyPair.privateKey is deliberately non-extractable
    // (profile.js's reconstructKeyPairFromRaw), so the 32-byte scalar
    // cannot be read off it directly -- exportRawIdentity re-decrypts the
    // vault under the just-entered passphrase and hands back extractable
    // raw key bytes, from which the scalar can be exported. This works
    // identically for a portable account or a plain permanent profile.
    const identityRaw = await exportRawIdentity(state.senderKey, passphrase);
    el("recovery-setup-passphrase").value = "";
    const extractableKey = await importPrivateKeyRaw(identityRaw, { name: "ECDSA", namedCurve: "P-256" }, true);
    const scalar = await exportPrivateKeyScalar(extractableKey);

    const shares = splitSecret(scalar, { threshold, shares: selected.length });
    const exportRows = [];
    for (let i = 0; i < selected.length; i++) {
      const contactFingerprint = selected[i];
      const share = shares[i];
      exportRows.push({ contactFingerprint, shareText: encodeShareAsText(share) });
      if (contactFingerprint === state.peerFingerprint && state.channel && state.sessionKey) {
        // Currently connected to this contact right now -- send immediately,
        // no need to queue. Also drop any STALE entry left over from an
        // earlier setup run (exec review iter1 finding) -- otherwise it
        // would later overwrite this fresh share with one from a
        // superseded, incompatible split.
        state.channel.send(
          await encryptMessage(state.sessionKey, JSON.stringify(buildRecoveryShareAnnounce(share)))
        );
        await dequeueRecoveryShareForContact(contactFingerprint);
      } else {
        // Not connected to this contact right now -- persist for delivery
        // the next time their identity-announce is verified (drained in
        // handleChatMessage's identity-announce branch).
        await queueRecoveryShareForContact(contactFingerprint, share);
      }
    }

    const exportEl = el("recovery-text-export");
    if (exportEl) {
      exportEl.hidden = false;
      exportEl.innerHTML = "";
      // Один QR-код на рядок -- саме на ТОЙ shareText, що показаний поруч,
      // не на весь список одразу. Показувати комусь QR усього списку
      // означало б розкрити чужі частки поряд зі своєю -- кожен довірений
      // контакт має сканувати лише свій власний рядок.
      for (const { contactFingerprint, shareText } of exportRows) {
        const row = doc.createElement("div");
        row.className = "recovery-share-export-row";
        const label = doc.createElement("div");
        label.textContent = formatSpiritId(contactFingerprint);
        row.appendChild(label);
        const text = doc.createElement("div");
        text.className = "secret-output";
        text.textContent = shareText;
        row.appendChild(text);
        const qr = doc.createElement("div");
        qr.className = "recovery-share-qr";
        qr.innerHTML = await qrSvgMarkup(shareText);
        row.appendChild(qr);
        exportEl.appendChild(row);
      }
    }
    setRecoveryStatus(t("recovery.setupDone", { n: selected.length, k: threshold }));
    await renderRecoveryCard();
  });

  // Section S2 (specs/phase5/social-recovery.md), KEY DESIGN DECISION:
  // "announce a recovery share to N specific trusted contacts" has no close
  // precedent in this codebase -- every existing *-announce (device-list,
  // proof-set, push-subscription) only ever reaches whoever you happen to be
  // chatting with RIGHT NOW (makeIdentityAnnouncer below), because there is
  // no persistent broadcast (zero-database invariant). Recovery setup picks
  // N contacts who are very likely NOT all connected at setup time.
  //
  // Simplest correct design chosen here: send immediately to any selected
  // contact who IS the live peer at setup time; for the rest, persist a
  // durable "outbound pending announce" queue (one entry per contact,
  // keyed by this profile's own senderKey so multiple local profiles don't
  // collide) and drain it opportunistically -- the same moment ANY peer's
  // identity-announce is verified (handleChatMessage's "identity-announce"
  // branch), check whether that peer is owed a queued share and send it
  // then. This mirrors how the other announces piggyback on connection,
  // just keyed per-recipient instead of "send to whoever is there".
  // Tradeoff: a selected contact who never reconnects while queued never
  // receives their share -- acceptable for a first cut (documented in the
  // spec) since re-running setup re-splits and re-queues anyway.
  function recoveryShareOutboxKey(senderKey) {
    return `recoveryShareOutbox:${senderKey}`;
  }

  async function queueRecoveryShareForContact(contactFingerprint, share) {
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const filtered = existing.filter((entry) => entry.contactFingerprint !== contactFingerprint);
    filtered.push({ contactFingerprint, announce: buildRecoveryShareAnnounce(share) });
    await put("profile", key, filtered);
  }

  /**
   * Removes any queued-but-not-yet-sent outbox entry for `contactFingerprint`,
   * without sending it. Exec review iter1 finding: the immediate-send branch
   * of btn-setup-recovery must call this for whichever contact it just sent
   * to directly -- otherwise a STALE entry from an earlier setup run (e.g.
   * that contact was offline last time, got queued, and is the live peer
   * this time) survives in the outbox and is delivered on their NEXT
   * reconnect, silently overwriting the fresh share just sent with a share
   * from an incompatible, superseded split (trustedShares.js's overwrite-on-
   * save then keeps the stale one, since it arrives later).
   */
  async function dequeueRecoveryShareForContact(contactFingerprint) {
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const filtered = existing.filter((entry) => entry.contactFingerprint !== contactFingerprint);
    if (filtered.length !== existing.length) {
      await put("profile", key, filtered);
    }
  }

  async function drainRecoveryShareOutboxForPeer(peerFingerprint) {
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey || !state.channel || !state.sessionKey) return;
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const index = existing.findIndex((entry) => entry.contactFingerprint === peerFingerprint);
    if (index === -1) return;
    const { announce } = existing[index];
    state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(announce)));
    const remaining = existing.filter((_, i) => i !== index);
    await put("profile", key, remaining);
  }

  // Section S3 (specs/phase5/social-recovery.md): owner-side recovery --
  // combine >= threshold pasted share-text strings back into the identity
  // scalar, then land in a logged-in state via the EXACT SAME post-scalar
  // adoption path as portable-login above (adoptScalarIdentity -> senderKey
  // -> nickname -> re-render cards -> remember session -> navigate). No new
  // security posture invented here, just a different way to arrive at the
  // same scalar.
  const setRecoveryRestoreStatus = (text) => {
    const status = el("recovery-restore-status");
    if (status) status.textContent = text;
  };
  el("link-toggle-recovery-restore")?.addEventListener("click", () => {
    el("recovery-restore-form").hidden = !el("recovery-restore-form").hidden;
  });
  if (el("btn-recover-from-shares")) withBusyButton(el("btn-recover-from-shares"), async () => {
    const shareTexts = el("recovery-restore-shares").value.split("\n");
    const passphrase = el("recovery-restore-passphrase").value;

    const result = recoverFromShares(shareTexts);
    if (!result.ok) {
      if (result.reason === "empty") setRecoveryRestoreStatus(t("recovery.restoreEmpty"));
      else if (result.reason === "malformed") setRecoveryRestoreStatus(t("recovery.restoreMalformed", { detail: result.detail }));
      else if (result.reason === "inconsistent") setRecoveryRestoreStatus(t("recovery.restoreInconsistent"));
      else if (result.reason === "insufficient") {
        const [have, need] = result.detail.match(/\d+/g) || [];
        setRecoveryRestoreStatus(t("recovery.restoreInsufficient", { have, need }));
      } else setRecoveryRestoreStatus(result.detail || result.reason);
      return;
    }
    if (!passphrase) {
      setRecoveryRestoreStatus(t("recovery.restoreNeedPassphrase"));
      return;
    }

    let identityKeyPair;
    try {
      identityKeyPair = await adoptScalarIdentity(result.scalar, passphrase);
    } catch {
      // Per Shamir's guarantee (shamir.js's combineShares doc comment),
      // combining an inconsistent/insufficient set of shares can't be
      // detected mathematically -- the only signal available is whether the
      // resulting bytes fail to import as a valid P-256 scalar (the known
      // ~2^-32 edge case, deterministicIdentity.js) or, more commonly here,
      // that the caller pasted shares from the wrong set that still happen
      // to be self-consistent. Either way: a clear, actionable message, not
      // a cryptic stack trace, per the spec's explicit UX requirement.
      // Exec review nice-to-have: don't wipe the pasted shares on a
      // RETRYABLE failure -- the UX copy explicitly invites the user to
      // "try again", and the individual share texts are below-threshold-
      // useless on their own (no security reason to force a full re-paste
      // mid-recovery-crisis). Only the passphrase is cleared here.
      el("recovery-restore-passphrase").value = "";
      setRecoveryRestoreStatus(t("recovery.restoreImportFailed"));
      return;
    }
    // Don't leave the reconstructed key material or passphrase sitting in
    // DOM inputs any longer than needed (same care as every other
    // raw-key-handling path in this file, e.g. btn-backup-mnemonic) -- only
    // on the success path, once the shares are no longer needed.
    el("recovery-restore-shares").value = "";
    el("recovery-restore-passphrase").value = "";

    state.identityKeyPair = identityKeyPair;
    state.senderKey = state.identityKeyPair.profileId;
    state.nickname = await getNickname(state.senderKey);
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    // Exec-review-flagged residual limitation (spec, Section S3): combining
    // shares can never cryptographically prove "this is definitely the
    // right key" -- the resulting fingerprint is surfaced prominently here
    // so the user can visually confirm it against what they expected
    // (a fingerprint they wrote down, or contacts recognizing it), the same
    // class of residual risk mnemonic restore already has.
    setRecoveryRestoreStatus(t("recovery.restoreSuccess", { fp: formatSpiritId(state.senderKey) }));
    rememberSession(state.senderKey, readSessionTtlHours());
    recordRecentAccount(state.senderKey);
    await refreshProfileSelector();
    navigate(postIdentityRoute());
  });

  return { renderRecoveryCard, drainRecoveryShareOutboxForPeer };
}
