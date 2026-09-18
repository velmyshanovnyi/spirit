// Section R5 (specs/phase5/app-decomposition.md, backlog A4): the contacts
// sidebar/screen and the live proof re-check extracted verbatim out of
// app.js's initApp() closure, continuing the G1/R1-R4 dependency-injection
// pattern. `state` is the same mutable object app.js holds; `navigate` is a
// lazy thunk over app.js's router (created later in initApp -- same TDZ
// dodge as R1); the six injected closure functions are either hoisted
// declarations or consts from earlier init modules. Only the two returned
// functions are consumed by app.js.
import { listContacts, getContact } from "./contacts.js";
import { listGroups } from "./groups.js";
import { buildIdenticonSvg } from "./identicon.js";
import { formatSpiritId } from "./spiritId.js";
import { getSetting } from "./settingsRegistry.js";
import { fetchProofPageText } from "./fetchProof.js";
import { parseProofBlock, verifyProofBlock } from "./proofs.js";

export function initContactsUI({
  doc,
  el,
  t,
  state,
  win,
  navigate,
  applyContactsFilter,
  setContactDragFingerprint,
  setGroupDragId,
  openGroupConversation,
  initiateChatSession,
  renderGroupsCard,
  renderImportedContactsScreen
}) {
  // Section E (specs/phase2c/identity-verification.md): in-memory verification
  // status per (contact fingerprint, proof url) -- re-derived from a live
  // fetch each check, so it doesn't need to survive a reload. `null`
  // verifiedAt/failedAt means "not checked yet this session".
  const proofVerification = new Map();
  const proofVerificationKey = (fingerprint, url) => `${fingerprint}|${url}`;

  async function renderContactsScreen() {
    const list = el("contacts-list");
    const empty = el("contacts-empty");
    if (!list || !empty) return; // screen not present in this document (e.g. older test fixture)
    const contacts = await listContacts();
    list.innerHTML = "";
    empty.hidden = contacts.length > 0;

    // Секція RF3 (shape-coded avatar system, "Тінь"): ефемерна "духова"
    // сесія (F3, specs/ui/ephemeral-spirit-mode.md) НЕ є контактом -- за
    // архітектурним інваріантом D1 (zero-database) нічого про неї не
    // зберігається, тож у папку/фільтр вона не потрапляє і зникає, щойно
    // з'єднання завершено. Це лише живий покажчик "зараз є активна ефемерна
    // розмова" -- shape-ghost-аватар, клік повертає до екрана розмови.
    // Умова -- та сама, що вже використовує ephemeral-identity-banner
    // (isEphemeral, рядок ~574): є тимчасовий нік, але немає vaultKey.
    const isEphemeral = !!state.nickname && !(state.identityKeyPair && state.identityKeyPair.vaultKey);
    if (isEphemeral && state.activeConnectionId) {
      const ghostRow = doc.createElement("div");
      ghostRow.className = "list-row";
      ghostRow.dataset.ephemeralSession = "1";
      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-ghost";
      avatar.innerHTML = buildIdenticonSvg(state.activeConnectionId);
      ghostRow.appendChild(avatar);
      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = state.nickname;
      cTop.appendChild(nameEl);
      cMain.appendChild(cTop);
      ghostRow.appendChild(cMain);
      ghostRow.addEventListener("click", () => navigate("conversation"));
      list.appendChild(ghostRow);
      empty.hidden = true;
    }

    for (const contact of contacts) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.contactFingerprint = contact.fingerprint;
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        setContactDragFingerprint(contact.fingerprint);
      });
      row.addEventListener("dragend", () => {
        setContactDragFingerprint(null);
      });

      // Секція RF2 (specs/ui/redesign-foundation.md): identicon-аватар,
      // детермінований з fingerprint. Кожен контакт у цьому списку -- TOFU-
      // контакт із постійним профілем, тож форма завжди "shape-user" (коло);
      // "shape-group"/"shape-ghost" -- ті самі квадрат/привид-класи, що
      // тепер рендеряться нижче для груп і для активної ефемерної сесії.
      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-user";
      avatar.innerHTML = buildIdenticonSvg(contact.fingerprint);
      row.appendChild(avatar);

      // Two-line row layout (UI redesign follow-up to SD1, matching the
      // agreed mockup): avatar on the left, name+trust-shield on the top
      // line, proof badges + message button on the line below. Nesting
      // doesn't affect existing selectors -- row.querySelector(...) finds
      // these by class/attribute regardless of depth.
      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const cSub = doc.createElement("div");
      cSub.className = "c-sub";
      cMain.appendChild(cTop);
      cMain.appendChild(cSub);
      row.appendChild(cMain);

      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = contact.nickname
        ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})`
        : formatSpiritId(contact.fingerprint);
      cTop.appendChild(nameEl);

      // Фаза 4 (docs/roadmap.md, TOFU-прогалина зафіксована 2026-07-18):
      // identity-announce вже автентифікує ECDH-сесію (Секція 12), але сам
      // identity-ключ при ПЕРШІЙ зустрічі приймається без позаканального
      // доказу (TOFU). Наявні proof-механізми (2c/2d) досі опційні й
      // непомітні. Секція RF2: замінює текстовий "не підтверджено" бейдж на
      // іконку щита довіри -- заповнений з галочкою, якщо хоч один proof
      // наразі показує підтверджений verifiedAt, інакше контурний (той самий
      // випадок, що й "жодного proof взагалі"). Текстовий еквівалент
      // лишається через aria-label/title для доступності.
      const hasVerifiedProof = (contact.proofSet?.proofs ?? []).some((proof) => {
        const v = proofVerification.get(proofVerificationKey(contact.fingerprint, proof.url));
        return !!v?.verifiedAt;
      });
      const shield = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      shield.setAttribute("viewBox", "0 0 24 24");
      shield.setAttribute("class", hasVerifiedProof ? "trust-shield trust-shield-verified" : "trust-shield");
      shield.setAttribute("role", "img");
      const shieldLabel = hasVerifiedProof ? t("contacts.verified") : t("contacts.unverified");
      shield.setAttribute("aria-label", shieldLabel);
      const shieldTitle = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      shieldTitle.textContent = shieldLabel;
      shield.appendChild(shieldTitle);
      const shieldPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      shieldPath.setAttribute("d", "M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z");
      shieldPath.setAttribute("fill", "none");
      shieldPath.setAttribute("stroke", "currentColor");
      shieldPath.setAttribute("stroke-width", "1.5");
      shield.appendChild(shieldPath);
      if (hasVerifiedProof) {
        const checkPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        checkPath.setAttribute("d", "M8.5 12.5l2.5 2.5 4.5-5");
        checkPath.setAttribute("fill", "none");
        checkPath.setAttribute("stroke", "currentColor");
        checkPath.setAttribute("stroke-width", "1.5");
        shield.appendChild(checkPath);
      }
      shield.setAttribute("title", shieldTitle.textContent);
      cTop.appendChild(shield);
      row.dataset.verified = hasVerifiedProof ? "1" : "0";

      for (const proof of contact.proofSet?.proofs ?? []) {
        const badge = doc.createElement("span");
        badge.className = "proof-badge";
        const v = proofVerification.get(proofVerificationKey(contact.fingerprint, proof.url));
        if (v?.verifiedAt) {
          badge.textContent = ` ${proof.label}: ${t("proofs.verifiedAt", { date: new Date(v.verifiedAt).toLocaleString() })}`;
        } else if (v && v.consecutiveFailures >= getSetting("proofFailureThreshold")) {
          badge.textContent = ` ${proof.label}: ${t("proofs.failedSince", { date: new Date(v.failedAt).toLocaleString() })}`;
        } else {
          badge.textContent = ` ${proof.label}`;
        }
        cSub.appendChild(badge);
      }
      const messageButton = doc.createElement("button");
      messageButton.type = "button";
      messageButton.className = "btn-icon";
      messageButton.dataset.i18n = "contacts.message";
      messageButton.textContent = t("contacts.message");
      cSub.appendChild(messageButton);
      list.appendChild(row);
    }

    // Секція RF3 (UI redesign follow-up, узгоджена концепція "Тінь"):
    // групи тепер показуються в тому самому сайдбар-списку, що й контакти
    // -- квадратна identicon-аватарка (shape-group), клік відкриває групову
    // розмову напряму, без переходу через екран "Керування". Групи можуть
    // прив'язуватись до папок тим самим drag&drop-шляхом, що й контакти
    // (нижче) -- те саме single-membership правило, той самий гейт на
    // folderEditMode. Груп немає у verified-фільтрі (немає proof-семантики),
    // звичайний пошук і далі працює через textContent.
    const groups = await listGroups();
    for (const group of groups) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.groupId = group.groupId;
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        setGroupDragId(group.groupId);
      });
      row.addEventListener("dragend", () => {
        setGroupDragId(null);
      });

      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-group";
      avatar.innerHTML = buildIdenticonSvg(group.groupId);
      row.appendChild(avatar);

      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = group.name;
      cTop.appendChild(nameEl);
      cMain.appendChild(cTop);
      row.appendChild(cMain);

      row.addEventListener("click", () => openGroupConversation(group.groupId, group.name));
      list.appendChild(row);
    }

    applyContactsFilter();
  }

  // Section PN5 (specs/phase5/push-notifications.md): a single delegated
  // listener on the list container, rather than one per row (rows are
  // rebuilt on every renderContactsScreen() call). Every contact shown here
  // is, by construction, a saved contact with no live P2P channel right now
  // (if one existed, the app would already be on the conversation screen,
  // not the contacts list) -- so there is no separate "is this contact
  // online" check needed before starting a fresh invite-based session.
  el("contacts-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-i18n='contacts.message']");
    if (!button) return;
    const row = button.closest("[data-contact-fingerprint]");
    const targetFingerprint = row?.dataset.contactFingerprint;
    if (!targetFingerprint) return;
    const contact = await getContact(targetFingerprint);
    await initiateChatSession({ pushToContact: contact ?? null, expectedFingerprint: targetFingerprint });
  });

  /**
   * Re-checks every contact's held proofs against their live publication --
   * called on demand ("Перевірити зараз") and on the periodic timer below.
   * A single fetch/verify failure doesn't flip the badge to "failed"
   * immediately (transient network hiccups are common); only
   * the "proofFailureThreshold" setting's consecutive failures do (docs/identity-verification.md).
   */
  async function checkContactProofs() {
    const contacts = await listContacts();
    for (const contact of contacts) {
      for (const proof of contact.proofSet?.proofs ?? []) {
        const key = proofVerificationKey(contact.fingerprint, proof.url);
        const prev = proofVerification.get(key);
        try {
          const text = await fetchProofPageText(el("server-url").value, state.senderKey, proof.url);
          const parsed = parseProofBlock(text);
          const ok = await verifyProofBlock(parsed, contact.identityPubkeyWire);
          if (ok) {
            proofVerification.set(key, { verifiedAt: Date.now(), failedAt: null, consecutiveFailures: 0 });
          } else {
            proofVerification.set(key, {
              verifiedAt: null,
              failedAt: Date.now(),
              consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1
            });
          }
        } catch {
          proofVerification.set(key, {
            verifiedAt: null,
            failedAt: Date.now(),
            consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1
          });
        }
      }
    }
    const route = win.location.hash.replace(/^#\/?/, "");
    // Section SD1 (specs/ui/persistent-sidebar.md): the sidebar's contact
    // list is always visible now regardless of the active route, so it must
    // re-render unconditionally -- only the manage-screen's groups/import
    // cards stay gated to the "manage" route.
    await renderContactsScreen();
    if (route === "manage") {
      await renderGroupsCard();
      await renderImportedContactsScreen();
    }
  }

  return { renderContactsScreen, checkContactProofs };
}
