// Section R4 (specs/phase5/app-decomposition.md, backlog A4): the imported-
// contacts domain (Sections I2/I3, specs/phase2b/import.md) extracted
// verbatim out of app.js's initApp() closure, continuing the G1/R1-R3
// dependency-injection pattern. `state` is the same mutable object app.js
// holds (nickname / identityKeyPair / senderKey are read live, not
// snapshotted). app.js consumes only renderImportedContactsScreen;
// inferImportedDirection is additionally returned for the boundary test.
import {
  saveImportedContact,
  listImportedContacts,
  getImportedContact,
  setMatchedFingerprint,
  deleteImportedContact,
  clearPendingMessages
} from "./importedContacts.js";
import { parseContactList, parseChatExport } from "./importParsers.js";
import { appendMessage } from "./historyStore.js";
import { listContacts } from "./contacts.js";
import { formatSpiritId } from "./spiritId.js";

export function initImportedContactsUI({ doc, el, t, state }) {
  const setImportStatus = (text) => {
    const status = el("import-status");
    if (status) status.textContent = text;
  };

  /**
   * Section I2 (specs/phase2b/import.md): renders the pending-import list on
   * the Contacts screen. A pending import with no matchedFingerprint shows a
   * <select> of every REAL Spirit contact (never a pre-filtered "likely
   * match" -- matching is manual-only by design, see docs/migration.md) plus
   * a Match button; once matched it shows the matched contact's identity
   * instead. An unmatched import persists indefinitely -- there is no
   * expiry/auto-delete path anywhere in this function.
   */
  async function renderImportedContactsScreen() {
    const list = el("import-pending-list");
    const empty = el("import-pending-empty");
    if (!list) return; // screen not present in this document (e.g. older test fixture)
    const [imports, contacts] = await Promise.all([listImportedContacts(), listContacts()]);
    list.innerHTML = "";
    if (empty) empty.hidden = imports.length > 0;
    for (const record of imports) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.importedId = record.id;

      const label = doc.createElement("span");
      label.textContent = `${record.displayName} (${record.sourceIdentifier})`;
      if (record.pendingMessages?.length) {
        label.textContent += ` ${t("import.pendingMessagesCount", { count: record.pendingMessages.length })}`;
      }
      row.appendChild(label);

      if (record.matchedFingerprint) {
        const matchedContact = contacts.find((c) => c.fingerprint === record.matchedFingerprint);
        const matchedLabel = matchedContact?.nickname
          ? `${matchedContact.nickname} (${formatSpiritId(record.matchedFingerprint)})`
          : formatSpiritId(record.matchedFingerprint);
        const matchedSpan = doc.createElement("span");
        matchedSpan.textContent = ` ${t("import.matchedWith", { contact: matchedLabel })}`;
        row.appendChild(matchedSpan);
      } else {
        const select = doc.createElement("select");
        const placeholderOption = doc.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = t("import.matchPlaceholder");
        select.appendChild(placeholderOption);
        for (const contact of contacts) {
          const option = doc.createElement("option");
          option.value = contact.fingerprint;
          option.textContent = contact.nickname
            ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})`
            : formatSpiritId(contact.fingerprint);
          select.appendChild(option);
        }
        row.appendChild(select);

        const matchButton = doc.createElement("button");
        matchButton.type = "button";
        matchButton.textContent = t("import.matchButton");
        matchButton.dataset.matchBtn = record.id;
        row.appendChild(matchButton);
      }

      const deleteButton = doc.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = t("import.delete");
      deleteButton.dataset.deleteBtn = record.id;
      row.appendChild(deleteButton);

      list.appendChild(row);
    }
  }

  /**
   * Section I3 (specs/phase2b/import.md): picks a display name for a
   * pending "imported history" record out of the parsed messages, since
   * parseChatExport's return shape ({ timestamp, sender, text }[]) carries
   * no separate chat/contact name. Heuristic (documented, not guaranteed
   * accurate): the first sender that does NOT match the currently active
   * profile's own nickname, so the label names "the other person" rather
   * than "me" when that's determinable; falls back to the very first
   * message's sender, then to a fixed placeholder for an empty batch.
   */
  function deriveImportedHistoryDisplayName(messages) {
    const ownName = (state.nickname || "").trim().toLowerCase();
    const other = messages.find((m) => (m.sender || "").trim().toLowerCase() !== ownName);
    return (other || messages[0])?.sender || t("import.historyFallbackName");
  }

  /**
   * Section I3: there is no cryptographic "sent by me via Spirit" vs
   * "received via Spirit" distinction for historical import -- the message
   * never went through this device's E2EE session. Best-effort heuristic:
   * if the message's `sender` string matches the active profile's own
   * nickname (case-insensitive, trimmed), treat it as "out"; otherwise (and
   * whenever the own nickname isn't confidently known) default to "in".
   * This is explicitly a heuristic, not a reliable authorship signal.
   */
  function inferImportedDirection(sender) {
    const ownName = (state.nickname || "").trim().toLowerCase();
    if (ownName && (sender || "").trim().toLowerCase() === ownName) return "out";
    return "in";
  }

  const importFileInput = el("import-file-input");
  if (importFileInput) {
    importFileInput.addEventListener("change", async () => {
      const file = importFileInput.files && importFileInput.files[0];
      importFileInput.value = "";
      if (!file) return;
      const format = el("import-format")?.value || "vcard";
      try {
        const text = await file.text();
        if (format === "whatsapp-txt") {
          // History-only format (Section I3): WhatsApp .txt exports carry
          // no structured contact list (see importParsers.js), so
          // parseContactList is never attempted for this format -- only
          // parseChatExport, with the parsed messages queued as a single
          // pending "imported history" record awaiting manual match.
          const messages = parseChatExport(text, format);
          if (messages.length > 0) {
            await saveImportedContact({
              displayName: deriveImportedHistoryDisplayName(messages),
              sourceIdentifier: t("import.historySourceIdentifier"),
              source: format,
              pendingMessages: messages
            });
          }
        } else {
          const parsed = parseContactList(text, format);
          for (const entry of parsed) {
            await saveImportedContact({
              displayName: entry.displayName,
              sourceIdentifier: entry.sourceIdentifier,
              source: format
            });
          }
          // The same Telegram-JSON export file commonly carries chat
          // history alongside (or instead of) a contact list
          // (docs/migration.md). Attempt parseChatExport on the SAME text
          // too; a contacts-only export has no top-level `messages` array
          // and parseChatExport throws -- that failure is EXPECTED and
          // silently ignored here, it must not invalidate the successful
          // contact import above.
          if (format === "telegram-json") {
            try {
              const messages = parseChatExport(text, "telegram-json");
              if (messages.length > 0) {
                await saveImportedContact({
                  displayName: deriveImportedHistoryDisplayName(messages),
                  sourceIdentifier: t("import.historySourceIdentifier"),
                  source: "telegram-json-history",
                  pendingMessages: messages
                });
              }
            } catch {
              // Contacts-only Telegram export -- no messages array. Expected.
            }
          }
        }
        setImportStatus("");
      } catch (e) {
        setImportStatus(t("import.parseError", { detail: e.message }));
      }
      await renderImportedContactsScreen();
    });
  }

  // Single delegated listener on the pending-import list container (rows
  // are rebuilt on every renderImportedContactsScreen() call), same pattern
  // as #contacts-list's message-button delegate above.
  el("import-pending-list")?.addEventListener("click", async (event) => {
    const matchButton = event.target.closest("[data-match-btn]");
    if (matchButton) {
      const row = matchButton.closest("[data-imported-id]");
      const select = row?.querySelector("select");
      const fingerprint = select?.value;
      if (!fingerprint) return;
      const importedId = matchButton.dataset.matchBtn;
      await setMatchedFingerprint(importedId, fingerprint);
      // Section I3: this is the ONLY place parsed history messages get
      // written into historyStore.js -- exclusively right after a manual
      // match, never speculatively before one (docs/migration.md's
      // manual-match invariant applies to imported history too).
      const record = await getImportedContact(importedId);
      if (record?.pendingMessages?.length) {
        if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
          for (const msg of record.pendingMessages) {
            await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, fingerprint, {
              direction: inferImportedDirection(msg.sender),
              text: msg.text,
              timestamp: msg.timestamp,
              imported: true
            });
          }
          await clearPendingMessages(importedId);
        } else {
          // No persistent history without a vault key (ephemeral mode --
          // historyStore.js is never written to there, docs/e2ee.md). Left
          // unhandled, pendingMessages would be silently stranded once the
          // record shows as matched (the Match UI disappears). Surface it
          // instead of losing the imported history with no feedback.
          setImportStatus(t("import.ephemeralHistorySkipped"));
        }
      }
      await renderImportedContactsScreen();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-btn]");
    if (deleteButton) {
      await deleteImportedContact(deleteButton.dataset.deleteBtn);
      await renderImportedContactsScreen();
    }
  });

  return { renderImportedContactsScreen, inferImportedDirection };
}
