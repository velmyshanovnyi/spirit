import { createGroup, listGroups } from "./groups.js";
import { listContacts, getContact } from "./contacts.js";
import { formatSpiritId } from "./spiritId.js";

/**
 * Section G1 (specs/reviews/spirit-evaluation-triage.md): third module
 * extracted out of app.js's initApp() closure -- the "create group" card
 * (contact checkboxes + existing-groups list with per-group add-member
 * picker), moved verbatim. Unlike settingsPanelUI.js/sidebarFoldersUI.js,
 * this one DOES need a few things that stay in app.js because they're
 * inseparable from the app's central `state`/live WebRTC session
 * machinery: `startTaggedGroupInvite` (mints an invite and, for the first
 * selected member, a real listening session via startInitiatorSession) and
 * `openGroupConversation` (navigates into the shared conversation screen,
 * touches `state.activeGroupId` and the mesh/message-relay machinery) --
 * both passed in rather than moved. `state` itself is passed in read-only
 * (only `state.senderKey` is read, never written, here).
 */
export function initGroupsUI({ doc, el, t, state, withBusyButton, setGroupStatus, buildInviteLinkText, startTaggedGroupInvite, openGroupConversation }) {
  /**
   * Section GC2: renders the "create group" contact checkboxes (mirrors
   * #recovery-contacts-list's pattern exactly, Section S2) plus the list of
   * already-created groups, each with a per-group "add member" contact
   * picker for contacts not already in that group's roster.
   */
  async function renderGroupsCard() {
    const card = el("groups-card");
    if (!card) return;
    const contacts = await listContacts();

    const createList = el("group-contacts-list");
    if (createList) {
      createList.innerHTML = "";
      for (const contact of contacts) {
        const row = doc.createElement("label");
        row.className = "field checkbox-field";
        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.groupContactFingerprint = contact.fingerprint;
        const span = doc.createElement("span");
        span.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
        row.appendChild(checkbox);
        row.appendChild(span);
        createList.appendChild(row);
      }
    }

    const groupsList = el("groups-list");
    const groupsEmpty = el("groups-empty");
    if (groupsList) {
      const groups = await listGroups();
      groupsList.innerHTML = "";
      if (groupsEmpty) groupsEmpty.hidden = groups.length > 0;
      for (const group of groups) {
        const row = doc.createElement("div");
        row.className = "list-row";
        const label = doc.createElement("span");
        label.textContent = `${group.name} (${group.memberFingerprints.length})`;
        row.appendChild(label);

        // Section GC3 design point 5: opens this group's conversation in
        // the shared conversation-screen UI (openGroupConversation, wired
        // via the groups-list click delegate below).
        const openButton = doc.createElement("button");
        openButton.type = "button";
        openButton.textContent = t("btn.openGroup");
        openButton.dataset.openGroupBtn = group.groupId;
        openButton.dataset.openGroupName = group.name;
        row.appendChild(openButton);

        const addable = contacts.filter((c) => !group.memberFingerprints.includes(c.fingerprint));
        if (addable.length > 0) {
          const select = doc.createElement("select");
          select.dataset.addMemberSelect = group.groupId;
          for (const contact of addable) {
            const option = doc.createElement("option");
            option.value = contact.fingerprint;
            option.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
            select.appendChild(option);
          }
          row.appendChild(select);
          const addButton = doc.createElement("button");
          addButton.type = "button";
          addButton.textContent = t("btn.addMember");
          addButton.dataset.addMemberBtn = group.groupId;
          row.appendChild(addButton);
        }
        groupsList.appendChild(row);
      }
    }
  }

  if (el("btn-create-group")) withBusyButton(el("btn-create-group"), async () => {
    const name = el("group-name").value.trim();
    const selected = [...doc.querySelectorAll("[data-group-contact-fingerprint]:checked")].map(
      (checkbox) => checkbox.dataset.groupContactFingerprint
    );
    if (!name) {
      setGroupStatus(t("groups.needName"));
      return;
    }
    if (!state.senderKey) {
      setGroupStatus(t("status.createAccountFirst"));
      return;
    }
    const group = await createGroup({ name, memberFingerprints: selected });
    const lines = [];
    // GC2 exec-review iter1 finding: only the FIRST selected contact gets a
    // real, live, listening session right now (startLiveSession: true) --
    // see startTaggedGroupInvite's doc comment for why running several
    // concurrent initiator handshakes would corrupt each other's session
    // state. Every other selected contact's invite link is minted
    // (createInvite only) for the owner to share out-of-band and connect
    // to individually later, one at a time.
    for (let i = 0; i < selected.length; i++) {
      const fingerprint = selected[i];
      const contact = await getContact(fingerprint);
      const memberLabel = contact?.nickname || formatSpiritId(fingerprint);
      const { roomId, inviteToken } = await startTaggedGroupInvite({ groupId: group.groupId, startLiveSession: i === 0 });
      lines.push(t("groups.inviteLine", { name: memberLabel, link: buildInviteLinkText(roomId, inviteToken, group.groupId) }));
    }
    const linksEl = el("group-invite-links");
    if (linksEl) {
      linksEl.hidden = false;
      linksEl.textContent = lines.join("\n");
    }
    el("group-name").value = "";
    setGroupStatus(t("groups.created", { name }));
    await renderGroupsCard();
  });

  // Section GC3: separate delegate for "open group conversation", checked
  // first -- a row can have BOTH an open button and an add-member button.
  el("groups-list")?.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-open-group-btn]");
    if (!openButton) return;
    await openGroupConversation(openButton.dataset.openGroupBtn, openButton.dataset.openGroupName);
  });

  el("groups-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-add-member-btn]");
    if (!button) return;
    const groupId = button.dataset.addMemberBtn;
    const select = doc.querySelector(`[data-add-member-select="${groupId}"]`);
    const fingerprint = select?.value;
    if (!fingerprint) return;
    const contact = await getContact(fingerprint);
    const memberLabel = contact?.nickname || formatSpiritId(fingerprint);
    const { roomId, inviteToken } = await startTaggedGroupInvite({ groupId });
    const linksEl = el("group-invite-links");
    if (linksEl) {
      linksEl.hidden = false;
      linksEl.textContent = t("groups.inviteLine", { name: memberLabel, link: buildInviteLinkText(roomId, inviteToken, groupId) });
    }
    setGroupStatus(t("groups.memberAdded", { name: memberLabel }));
    await renderGroupsCard();
  });

  return { renderGroupsCard };
}
