/**
 * Section G1 (specs/reviews/spirit-evaluation-triage.md): second module
 * extracted out of app.js's initApp() closure -- sidebar contact search/
 * verified-filter chips + the nested folder tree (drag&drop, rename,
 * delete), moved verbatim. Genuinely self-contained w.r.t. the app's
 * central `state` object (never touches it), but NOT fully independent
 * like settingsPanelUI.js: `contactDragFingerprint`/`groupDragId` are SET
 * by app.js's own contact/group row dragstart/dragend handlers
 * (renderContactsScreen stays in app.js, it's deeply `state`-coupled) and
 * READ here by the folder row's drop handler -- exposed as
 * setContactDragFingerprint/setGroupDragId so app.js's handlers call into
 * this module instead of mutating a shared local. `applyContactsFilter`
 * is returned because renderContactsScreen calls it at the end of every
 * render.
 */
export function initSidebarFoldersUI({ doc, el, t }) {
  let contactsVerifiedOnly = false;
  let selectedFolderId = null;
  // Комбінований набір id-шок (contactFingerprints + groupIds) -- namespace
  // не перетинається на практиці (64-символьний hex fingerprint проти
  // 32-символьного hex groupId), а кожен рядок звіряється лише зі СВОЇМ
  // атрибутом (contactFingerprint або groupId), тож об'єднання безпечне.
  function collectFolderMemberIds(node) {
    let ids = [...(node.contactFingerprints || []), ...(node.groupIds || [])];
    for (const child of node.children) ids = ids.concat(collectFolderMemberIds(child));
    return ids;
  }
  function applyContactsFilter() {
    const query = (el("sidebar-search-input")?.value ?? "").trim().toLowerCase();
    const selectedFolder = selectedFolderId && findFolder(folders, selectedFolderId);
    const folderMemberIds = selectedFolder ? new Set(collectFolderMemberIds(selectedFolder)) : null;
    for (const row of doc.querySelectorAll("#contacts-list .list-row")) {
      const matchesQuery = query.length === 0 || row.textContent.toLowerCase().includes(query);
      const matchesVerified = !contactsVerifiedOnly || row.dataset.verified === "1";
      const rowMemberId = row.dataset.contactFingerprint ?? row.dataset.groupId;
      const matchesFolder = !folderMemberIds || folderMemberIds.has(rowMemberId);
      row.hidden = !matchesQuery || !matchesVerified || !matchesFolder;
    }
  }
  el("sidebar-search-input")?.addEventListener("input", applyContactsFilter);

  // Section RF3 (UI redesign follow-up): "Групи" now navigates to the
  // manage screen via router.js's existing .nav-item[data-route] auto-wiring
  // (see index.html), so only "Усі"/"Верифіковані" need a click handler here
  // -- they toggle contactsVerifiedOnly and re-run the same filter the
  // search box uses, rather than being a separate filtering path. "Усі"
  // also clears any active folder selection (see renderFolderTree below),
  // since it means "show every contact, no filter at all".
  el("chip-filter-all")?.addEventListener("click", () => {
    contactsVerifiedOnly = false;
    selectedFolderId = null;
    el("chip-filter-all")?.classList.add("chip-active");
    el("chip-filter-verified")?.classList.remove("chip-active");
    renderFolderTree();
    applyContactsFilter();
  });
  el("chip-filter-verified")?.addEventListener("click", () => {
    contactsVerifiedOnly = true;
    el("chip-filter-verified")?.classList.add("chip-active");
    el("chip-filter-all")?.classList.remove("chip-active");
    applyContactsFilter();
  });

  // Дерево папок (UI redesign follow-up, специфіковано в мокапі): вкладені,
  // необмежена глибина, drag&drop переміщення/вкладення папок ОДНА В ОДНУ,
  // localStorage-персистентність (пристрій-рівень, не IndexedDB/профіль --
  // та сама причина, що й `spirit.signalingNodes`, Секція multi-node-ui).
  // Прив'язка КОНТАКТІВ до папок (drag контакту з #contacts-list на рядок
  // папки, клік на папку фільтрує список) реалізована нижче -- модель
  // "один контакт в одній папці одночасно" (перетягнення в іншу папку
  // видаляє з попередньої), той самий ментальний принцип, що й звичайні
  // файлові менеджери. Синхронізація між пристроями лишається майбутньою
  // секцією (той самий локальний-лише статус, що й уся ця фіча).
  const FOLDER_STORAGE_KEY = "spirit.folders";
  function normalizeFolderNodes(nodes) {
    for (const n of nodes) {
      if (!Array.isArray(n.contactFingerprints)) n.contactFingerprints = [];
      if (!Array.isArray(n.groupIds)) n.groupIds = [];
      normalizeFolderNodes(n.children);
    }
    return nodes;
  }
  function loadFolders() {
    try {
      const raw = localStorage.getItem(FOLDER_STORAGE_KEY);
      return normalizeFolderNodes(raw ? JSON.parse(raw) : []);
    } catch {
      return [];
    }
  }
  function saveFolders(nodes) {
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(nodes));
    } catch {
      // Best-effort only -- a full/unavailable localStorage just means
      // folders won't persist across reloads, not a functional break.
    }
  }
  const folders = loadFolders();
  const folderCollapsed = new Set();
  let folderDragId = null;
  let contactDragFingerprint = null;
  let groupDragId = null;
  let folderRenamingId = null;
  let folderPendingDeleteId = null;
  // Один перемикач "олівець" на рівні заголовка "Мої папки" вмикає/вимикає
  // ВСІ структурні зміни (перейменування, видалення, додавання підпапки,
  // перетягування папок одна в одну, перетягування контакту на папку).
  // У вимкненому стані (типовий, за замовчуванням) папки працюють лише як
  // навігація -- згорнути/розгорнути (chev) і клік для фільтрації списку
  // контактів лишаються завжди активними незалежно від цього перемикача,
  // оскільки це не зміна структури, а звичайний перегляд.
  let folderEditMode = false;

  function removeFingerprintFromAllFolders(nodes, fingerprint) {
    for (const n of nodes) {
      n.contactFingerprints = n.contactFingerprints.filter((fp) => fp !== fingerprint);
      removeFingerprintFromAllFolders(n.children, fingerprint);
    }
  }
  function removeGroupIdFromAllFolders(nodes, groupId) {
    for (const n of nodes) {
      n.groupIds = n.groupIds.filter((id) => id !== groupId);
      removeGroupIdFromAllFolders(n.children, groupId);
    }
  }

  function findFolder(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findFolder(n.children, id);
      if (found) return found;
    }
    return null;
  }
  function isFolderDescendant(node, id) {
    if (node.id === id) return true;
    return node.children.some((c) => isFolderDescendant(c, id));
  }
  function removeFolder(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes.splice(i, 1)[0];
      const found = removeFolder(nodes[i].children, id);
      if (found) return found;
    }
    return null;
  }
  // Section G4 (specs/reviews/spirit-evaluation-triage.md): CONTRACT --
  // this must always produce only `[a-z0-9]+`. renderFolderTree() below
  // interpolates the result directly into an HTML attribute
  // (`data-folder-id="${n.id}"`) with no escaping; a value containing `"`
  // would break out of the attribute. Locked by a test in app.test.js
  // ("a newly created folder's id is always [a-z0-9]+ ..."). If this ever
  // needs to accept an id from an EXTERNAL source (e.g. a folder synced
  // from another device), validate/regenerate it against this pattern
  // before it reaches renderFolderTree, or switch that template to an
  // escaping helper -- don't just relax this format silently.
  function randomFolderId() {
    return "fd" + Math.random().toString(36).slice(2, 10);
  }
  // Видалення папки НЕ каскадно видаляє дочірні -- вони підіймаються на
  // рівень видаленої (той самий принцип, що й видалення папки у звичайному
  // файловому менеджері: втрачається сама папка й прив'язка ЇЇ ВЛАСНИХ
  // контактів, але не вкладений вміст). Повертає true, якщо щось видалено.
  function deleteFolder(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1, ...nodes[i].children);
        return true;
      }
      if (deleteFolder(nodes[i].children, id)) return true;
    }
    return false;
  }
  function renderFolderNodes(nodes) {
    return nodes
      .map((n) => {
        const collapsed = folderCollapsed.has(n.id);
        const hasKids = n.children.length > 0;
        const selected = selectedFolderId === n.id;
        const renaming = folderEditMode && folderRenamingId === n.id;
        const pendingDelete = folderEditMode && folderPendingDeleteId === n.id;
        const memberCount = n.contactFingerprints.length + n.groupIds.length;
        const nameMarkup = renaming
          ? `<input type="text" class="folder-rename-input" data-folder-rename-input>`
          : `<span class="folder-name"></span>` +
            (memberCount > 0 ? `<span class="folder-count">${memberCount}</span>` : "");
        const actionsMarkup = !folderEditMode
          ? ""
          : renaming
            ? `<span class="folder-actions">
                <button type="button" class="folder-action" data-folder-rename-save title="${t("sidebar.folderRenameSave")}">✓</button>
                <button type="button" class="folder-action" data-folder-rename-cancel title="${t("sidebar.folderRenameCancel")}">✕</button>
              </span>`
            : `<span class="folder-actions">
                <button type="button" class="folder-action" data-folder-rename title="${t("sidebar.folderRename")}">✎</button>
                <button type="button" class="folder-action" data-folder-add-child title="${t("sidebar.folderAddChild")}">+</button>
                <button type="button" class="folder-action folder-action-delete ${pendingDelete ? "confirming" : ""}" data-folder-delete title="${t(pendingDelete ? "sidebar.folderDeleteConfirm" : "sidebar.folderDelete")}">${pendingDelete ? "✓" : "×"}</button>
              </span>`;
        return `
          <div class="folder-row ${collapsed ? "collapsed" : ""} ${selected ? "selected" : ""}" data-folder-id="${n.id}" draggable="${folderEditMode && !renaming}">
            <span class="chev">${hasKids ? "▾" : ""}</span>
            ${nameMarkup}
            ${actionsMarkup}
          </div>
          ${hasKids ? `<div class="folder-children ${collapsed ? "collapsed" : ""}">${renderFolderNodes(n.children)}</div>` : ""}
        `;
      })
      .join("");
  }
  function renderFolderTree() {
    const treeEl = el("folder-tree");
    if (!treeEl) return;
    treeEl.innerHTML =
      `<div class="folder-tree-label"><span>${t("sidebar.foldersHeading")}</span>` +
      `<button type="button" class="folder-action ${folderEditMode ? "active" : ""}" data-folder-edit-toggle title="${t("sidebar.folderEditToggle")}">✎</button>` +
      (folderEditMode ? `<button type="button" data-add-folder title="${t("sidebar.addFolder")}">+</button>` : "") +
      `</div>` +
      renderFolderNodes(folders);
    treeEl.querySelector("[data-folder-edit-toggle]")?.addEventListener("click", () => {
      folderEditMode = !folderEditMode;
      if (!folderEditMode) {
        folderRenamingId = null;
        folderPendingDeleteId = null;
      }
      renderFolderTree();
    });
    treeEl.querySelectorAll("[data-folder-id]").forEach((rowEl) => {
      const id = rowEl.dataset.folderId;
      const node = findFolder(folders, id);
      if (!node) return;
      // Ім'я йде через textContent, а не в innerHTML-шаблон вище, тож
      // користувацька назва папки ніколи не зможе інʼєктнути розмітку.
      const nameEl = rowEl.querySelector(".folder-name");
      if (nameEl) nameEl.textContent = node.name;
      const renameInput = rowEl.querySelector("[data-folder-rename-input]");
      if (renameInput) {
        renameInput.value = node.name;
        renameInput.focus();
        renameInput.select();
      }

      rowEl.addEventListener("dragstart", () => {
        if (!folderEditMode) return;
        folderDragId = id;
      });
      rowEl.addEventListener("dragover", (event) => {
        if (!folderEditMode) return;
        event.preventDefault();
        if (contactDragFingerprint || groupDragId) {
          rowEl.classList.add("drag-over");
          return;
        }
        const dragged = folderDragId && findFolder(folders, folderDragId);
        if (dragged && folderDragId !== id && !isFolderDescendant(dragged, id)) {
          rowEl.classList.add("drag-over");
        }
      });
      rowEl.addEventListener("dragleave", () => rowEl.classList.remove("drag-over"));
      rowEl.addEventListener("click", (event) => {
        if (event.target.closest(".chev") || event.target.closest(".folder-actions") || event.target.closest("[data-folder-rename-input]")) return;
        selectedFolderId = selectedFolderId === id ? null : id;
        folderPendingDeleteId = null;
        renderFolderTree();
        applyContactsFilter();
      });

      function commitRename() {
        const input = rowEl.querySelector("[data-folder-rename-input]");
        const value = input?.value.trim();
        if (value) node.name = value;
        folderRenamingId = null;
        saveFolders(folders);
        renderFolderTree();
      }
      renameInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") commitRename();
        if (event.key === "Escape") {
          folderRenamingId = null;
          renderFolderTree();
        }
      });
      rowEl.querySelector("[data-folder-rename-save]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        commitRename();
      });
      rowEl.querySelector("[data-folder-rename-cancel]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderRenamingId = null;
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-rename]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderRenamingId = id;
        folderPendingDeleteId = null;
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-add-child]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        node.children.push({ id: randomFolderId(), name: t("sidebar.newFolder"), children: [], contactFingerprints: [], groupIds: [] });
        folderCollapsed.delete(id);
        saveFolders(folders);
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-delete]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (folderPendingDeleteId !== id) {
          folderPendingDeleteId = id;
          renderFolderTree();
          return;
        }
        folderPendingDeleteId = null;
        if (selectedFolderId === id) selectedFolderId = null;
        deleteFolder(folders, id);
        saveFolders(folders);
        renderFolderTree();
        applyContactsFilter();
      });
      rowEl.addEventListener("drop", (event) => {
        if (!folderEditMode) return;
        event.preventDefault();
        rowEl.classList.remove("drag-over");
        // Dropping a contact assigns it to this folder (single-membership --
        // it's first removed from every other folder, same mental model as
        // an ordinary file manager), independent of the folder-onto-folder
        // reorder/nest path below.
        if (contactDragFingerprint) {
          const fingerprint = contactDragFingerprint;
          contactDragFingerprint = null;
          removeFingerprintFromAllFolders(folders, fingerprint);
          const target = findFolder(folders, id);
          if (target && !target.contactFingerprints.includes(fingerprint)) {
            target.contactFingerprints.push(fingerprint);
          }
          saveFolders(folders);
          renderFolderTree();
          applyContactsFilter();
          return;
        }
        if (groupDragId) {
          const groupId = groupDragId;
          groupDragId = null;
          removeGroupIdFromAllFolders(folders, groupId);
          const target = findFolder(folders, id);
          if (target && !target.groupIds.includes(groupId)) {
            target.groupIds.push(groupId);
          }
          saveFolders(folders);
          renderFolderTree();
          applyContactsFilter();
          return;
        }
        if (!folderDragId || folderDragId === id) return;
        const dragged = findFolder(folders, folderDragId);
        if (!dragged || isFolderDescendant(dragged, id)) return;
        removeFolder(folders, folderDragId);
        const target = findFolder(folders, id);
        target.children.push(dragged);
        folderCollapsed.delete(id);
        saveFolders(folders);
        renderFolderTree();
      });
      rowEl.querySelector(".chev")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderCollapsed.has(id) ? folderCollapsed.delete(id) : folderCollapsed.add(id);
        renderFolderTree();
      });
    });
    treeEl.querySelector("[data-add-folder]")?.addEventListener("click", () => {
      folders.push({ id: randomFolderId(), name: t("sidebar.newFolder"), children: [], contactFingerprints: [], groupIds: [] });
      saveFolders(folders);
      renderFolderTree();
    });
  }
  renderFolderTree();

  return {
    applyContactsFilter,
    setContactDragFingerprint: (fingerprint) => {
      contactDragFingerprint = fingerprint;
    },
    setGroupDragId: (groupId) => {
      groupDragId = groupId;
    }
  };
}
