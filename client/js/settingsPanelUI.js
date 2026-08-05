import { getSetting, setSetting, resetSetting, resetAllSettings, SETTINGS } from "./settingsRegistry.js";
import {
  DESIGN_SETTINGS,
  getDesignSetting,
  setDesignSetting,
  resetDesignSetting,
  resetAllDesignSettings,
  applyDesignSettings
} from "./designSettingsRegistry.js";
import {
  FOOTER_ITEMS,
  isFooterItemVisible,
  setFooterItemVisible,
  listCustomBlocks,
  addCustomBlock,
  setCustomBlockHtml,
  removeCustomBlock,
  getFooterOrder,
  moveFooterEntry,
  resetFooterSettings,
  applyFooterSettings
} from "./footerRegistry.js";
import { TOGGLEABLE_FEATURE_KEYS, ADVANCED_FEATURES, isFeatureEnabled, setFeatureEnabled, resetFeatureFlags } from "./advancedMode.js";

/**
 * Section G1 (specs/reviews/spirit-evaluation-triage.md): first extraction
 * out of app.js's 5000+-line initApp() closure -- the Settings/Design
 * Settings panel (Section RF13/RF14, specs/ui/settings-panel.md) was a
 * clean, self-contained candidate: no dependency on `state` at all, only on
 * `doc`/`el`/`t` (passed in) and the two registry modules (imported here
 * directly instead of threaded through). Behavior is unchanged byte-for-byte
 * from the code this replaces -- app.test.js's existing settings/design
 * tests (DOM-driven, black-box) pass without modification, which is the
 * regression check for this kind of move.
 *
 * Returns { renderSettingsRegistry, renderDesignSettings } because app.js's
 * language-switch handler calls both after `setLocale()` -- see the
 * Section C6 fix (these two renders don't get touched by
 * applyTranslations() since they're built imperatively, no data-i18n).
 */
export function initSettingsPanelUI({ doc, el, t }) {
  // Section RF13 (specs/ui/settings-panel.md), Stage 1: renders SETTINGS
  // structurally -- one heading per category (deduped, in registry order),
  // one row per setting with its label/description/input/reset, so adding a
  // new tunable parameter later never requires new hand-written markup.
  function renderSettingsRegistry() {
    const list = el("settings-registry-list");
    if (!list) return;
    list.innerHTML = "";
    const categoryLabels = {
      connection: t("settings.category.connection"),
      identity: t("settings.category.identity"),
      fileTransfer: t("settings.category.fileTransfer"),
      accounts: t("settings.category.accounts"),
      ui: t("settings.category.ui"),
      notifications: t("settings.category.notifications")
    };
    let lastCategory = null;
    for (const entry of SETTINGS) {
      if (entry.category !== lastCategory) {
        lastCategory = entry.category;
        const heading = doc.createElement("h3");
        heading.textContent = categoryLabels[entry.category] || entry.category;
        list.appendChild(heading);
      }
      const row = doc.createElement("div");
      row.className = "settings-row";
      const label = doc.createElement("label");
      label.className = "field";
      const labelText = doc.createElement("span");
      labelText.textContent = t(entry.labelKey);
      label.appendChild(labelText);
      const input = doc.createElement("input");
      input.type = "number";
      input.min = String(entry.min);
      input.max = String(entry.max);
      input.value = String(getSetting(entry.key));
      input.dataset.settingKey = entry.key;
      label.appendChild(input);
      row.appendChild(label);
      const description = doc.createElement("p");
      description.className = "hint-text";
      description.textContent = t(entry.descriptionKey);
      row.appendChild(description);
      const resetBtn = doc.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-link";
      resetBtn.textContent = t("settings.resetOne");
      resetBtn.dataset.resetSettingKey = entry.key;
      row.appendChild(resetBtn);
      list.appendChild(row);
    }
  }
  renderSettingsRegistry();

  el("settings-registry-list")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-setting-key]");
    if (!input) return;
    if (!setSetting(input.dataset.settingKey, input.value)) {
      // Rejected (out of range/non-numeric) -- re-render to snap the field
      // back to whatever's actually stored, rather than leaving an invalid
      // value sitting in the input looking like it took effect.
      renderSettingsRegistry();
    }
  });
  el("settings-registry-list")?.addEventListener("click", (event) => {
    const resetBtn = event.target.closest("[data-reset-setting-key]");
    if (!resetBtn) return;
    resetSetting(resetBtn.dataset.resetSettingKey);
    renderSettingsRegistry();
  });
  el("btn-reset-all-settings")?.addEventListener("click", () => {
    resetAllSettings();
    renderSettingsRegistry();
  });

  // Section RF14 (specs/ui/settings-panel.md, design-settings extension):
  // same structural-rendering shape as renderSettingsRegistry above, but the
  // displayed value for a NOT-overridden setting comes from getComputedStyle
  // (the current theme's real value) rather than a fixed default -- light
  // and dark themes disagree on what "default" even means for a color.
  function renderDesignSettings() {
    const list = el("design-settings-list");
    if (!list) return;
    list.innerHTML = "";
    const categoryLabels = {
      colors: t("design.category.colors"),
      shape: t("design.category.shape"),
      typography: t("design.category.typography"),
      layout: t("design.category.layout"),
      visibility: t("design.category.visibility")
    };
    const computed = doc.defaultView.getComputedStyle(doc.documentElement);
    let lastCategory = null;
    for (const entry of DESIGN_SETTINGS) {
      if (entry.category !== lastCategory) {
        lastCategory = entry.category;
        const heading = doc.createElement("h3");
        heading.textContent = categoryLabels[entry.category] || entry.category;
        list.appendChild(heading);
      }
      const row = doc.createElement("div");
      row.className = "settings-row";
      const label = doc.createElement("label");
      label.className = "field";
      const labelText = doc.createElement("span");
      labelText.textContent = t(entry.labelKey);
      label.appendChild(labelText);

      const stored = getDesignSetting(entry.key);
      // Section RF17: "choice" settings have no cssVar to read a live
      // computed value from -- there's nothing to fall back to when unset,
      // the first option (e.g. "left") IS the stylesheet default.
      const currentRaw = entry.type === "boolean" || entry.type === "choice" ? "" : computed.getPropertyValue(entry.cssVar).trim();
      if (entry.type === "choice") {
        const currentValue = stored ?? entry.options[0];
        const toggle = doc.createElement("div");
        toggle.className = "choice-toggle";
        for (const option of entry.options) {
          const optionBtn = doc.createElement("button");
          optionBtn.type = "button";
          optionBtn.textContent = entry.optionLabelKeys[option] ? t(entry.optionLabelKeys[option]) : option;
          optionBtn.className = option === currentValue ? "chip chip-active" : "chip";
          optionBtn.dataset.designChoiceKey = entry.key;
          optionBtn.dataset.designChoiceValue = option;
          toggle.appendChild(optionBtn);
        }
        label.appendChild(toggle);
        row.appendChild(label);

        const description = doc.createElement("p");
        description.className = "hint-text";
        description.textContent = t(entry.descriptionKey);
        row.appendChild(description);

        const resetBtn = doc.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "btn-link";
        resetBtn.textContent = t("settings.resetOne");
        resetBtn.dataset.resetDesignSettingKey = entry.key;
        row.appendChild(resetBtn);
        list.appendChild(row);
        continue;
      }
      if (entry.type === "order") {
        const currentOrder = stored ?? entry.items.map((item) => item.key);
        const orderList = doc.createElement("div");
        orderList.className = "order-list";
        currentOrder.forEach((itemKey, index) => {
          const item = entry.items.find((i) => i.key === itemKey);
          if (!item) return;
          const itemRow = doc.createElement("div");
          itemRow.className = "order-list-item";
          const itemLabel = doc.createElement("span");
          itemLabel.textContent = t(item.labelKey);
          itemRow.appendChild(itemLabel);
          const upBtn = doc.createElement("button");
          upBtn.type = "button";
          upBtn.className = "btn-link";
          upBtn.textContent = "▲";
          upBtn.disabled = index === 0;
          upBtn.dataset.orderSettingKey = entry.key;
          upBtn.dataset.orderItemKey = itemKey;
          upBtn.dataset.orderMove = "up";
          itemRow.appendChild(upBtn);
          const downBtn = doc.createElement("button");
          downBtn.type = "button";
          downBtn.className = "btn-link";
          downBtn.textContent = "▼";
          downBtn.disabled = index === currentOrder.length - 1;
          downBtn.dataset.orderSettingKey = entry.key;
          downBtn.dataset.orderItemKey = itemKey;
          downBtn.dataset.orderMove = "down";
          itemRow.appendChild(downBtn);
          orderList.appendChild(itemRow);
        });
        label.appendChild(orderList);
        row.appendChild(label);

        const description = doc.createElement("p");
        description.className = "hint-text";
        description.textContent = t(entry.descriptionKey);
        row.appendChild(description);

        const resetBtn = doc.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "btn-link";
        resetBtn.textContent = t("settings.resetOne");
        resetBtn.dataset.resetDesignSettingKey = entry.key;
        row.appendChild(resetBtn);
        list.appendChild(row);
        continue;
      }
      const input = doc.createElement("input");
      input.dataset.designSettingKey = entry.key;
      if (entry.type === "boolean") {
        input.type = "checkbox";
        input.checked = stored === false ? false : true;
      } else if (entry.type === "color") {
        input.type = "color";
        // A CSS color value (named color, rgb(), etc.) isn't guaranteed to
        // be hex -- <input type=color> only accepts #rrggbb, so fall back
        // to a neutral value rather than leaving it on an invalid string.
        input.value = stored ?? (/^#[0-9a-fA-F]{6}$/.test(currentRaw) ? currentRaw : "#000000");
      } else if (entry.type === "length") {
        input.type = "number";
        input.min = String(entry.min);
        input.max = String(entry.max);
        input.value = String(stored ?? (parseFloat(currentRaw) || 0));
      } else {
        input.type = "text";
        input.value = stored ?? currentRaw;
      }
      label.appendChild(input);
      row.appendChild(label);

      const description = doc.createElement("p");
      description.className = "hint-text";
      description.textContent = t(entry.descriptionKey);
      row.appendChild(description);

      const resetBtn = doc.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-link";
      resetBtn.textContent = t("settings.resetOne");
      resetBtn.dataset.resetDesignSettingKey = entry.key;
      row.appendChild(resetBtn);
      list.appendChild(row);
    }
  }
  renderDesignSettings();

  el("design-settings-list")?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-design-setting-key]");
    if (!input) return;
    const value = input.type === "checkbox" ? input.checked : input.value;
    if (setDesignSetting(input.dataset.designSettingKey, value)) {
      applyDesignSettings(doc);
    } else {
      renderDesignSettings();
    }
  });
  el("design-settings-list")?.addEventListener("click", (event) => {
    const choiceBtn = event.target.closest("[data-design-choice-key]");
    if (choiceBtn) {
      if (setDesignSetting(choiceBtn.dataset.designChoiceKey, choiceBtn.dataset.designChoiceValue)) {
        applyDesignSettings(doc);
      }
      renderDesignSettings();
      return;
    }
    const orderBtn = event.target.closest("[data-order-setting-key]");
    if (orderBtn) {
      const entry = DESIGN_SETTINGS.find((e) => e.key === orderBtn.dataset.orderSettingKey);
      if (!entry) return;
      const current = getDesignSetting(entry.key) ?? entry.items.map((item) => item.key);
      const index = current.indexOf(orderBtn.dataset.orderItemKey);
      const swapWith = orderBtn.dataset.orderMove === "up" ? index - 1 : index + 1;
      if (index < 0 || swapWith < 0 || swapWith >= current.length) return;
      const next = [...current];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      if (setDesignSetting(entry.key, next)) {
        applyDesignSettings(doc);
      }
      renderDesignSettings();
      return;
    }
    const resetBtn = event.target.closest("[data-reset-design-setting-key]");
    if (!resetBtn) return;
    resetDesignSetting(resetBtn.dataset.resetDesignSettingKey);
    applyDesignSettings(doc);
    renderDesignSettings();
  });
  el("btn-reset-all-design-settings")?.addEventListener("click", () => {
    resetAllDesignSettings();
    applyDesignSettings(doc);
    renderDesignSettings();
  });

  // Section FC3 (specs/ui/footer-customization.md): a hand-written render,
  // NOT the generic DESIGN_SETTINGS-driven shape above -- custom HTML
  // blocks are a dynamic, user-managed list (add/remove at runtime, own
  // textarea+delete UI), which doesn't fit that registry's fixed-item
  // shape. Fixed items and custom blocks share ONE combined order
  // (footerRegistry.js's getFooterOrder()), rendered as one row list here,
  // reordered by the same ▲/▼ buttons regardless of which kind a row is.
  function renderFooterSettings() {
    const list = el("footer-settings-list");
    if (!list) return;
    list.innerHTML = "";
    const order = getFooterOrder();
    const blocksById = new Map(listCustomBlocks().map((b) => [b.id, b]));

    order.forEach((entryId, index) => {
      const row = doc.createElement("div");
      row.className = "settings-row order-list-item";
      row.dataset.footerOrderEntry = entryId;

      if (entryId.startsWith("custom:")) {
        const id = entryId.slice("custom:".length);
        const block = blocksById.get(id);
        if (!block) return;
        // Exec review finding 4 (specs/reviews/footer-customization-FC3-iter1.md):
        // a bare <span>+<textarea> pair has no accessible name -- wrap in
        // a <label>, matching every other row in this file (e.g. the
        // "field" label pattern used by renderSettingsRegistry above).
        const label = doc.createElement("label");
        label.className = "field";
        const labelText = doc.createElement("span");
        labelText.textContent = t("footerSettings.customBlockLabel");
        label.appendChild(labelText);
        const textarea = doc.createElement("textarea");
        textarea.value = block.html;
        textarea.placeholder = t("footerSettings.htmlPlaceholder");
        textarea.dataset.footerBlockId = id;
        label.appendChild(textarea);
        row.appendChild(label);
        const removeBtn = doc.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn-link";
        removeBtn.textContent = t("footerSettings.removeBlock");
        removeBtn.dataset.removeFooterBlockId = id;
        row.appendChild(removeBtn);
      } else {
        const item = FOOTER_ITEMS.find((i) => i.key === entryId);
        if (!item) return;
        // Section FC2 exec review finding 1: advancedToggle can never be
        // hidden (it's the only way back once locked) -- no checkbox for
        // it at all, order-only, so the UI doesn't even imply a control
        // that wouldn't work.
        if (item.key !== "advancedToggle") {
          const label = doc.createElement("label");
          label.className = "field";
          const checkbox = doc.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = isFooterItemVisible(item.key);
          checkbox.dataset.footerItemKey = item.key;
          label.appendChild(checkbox);
          const labelText = doc.createElement("span");
          labelText.textContent = t(item.labelKey);
          label.appendChild(labelText);
          row.appendChild(label);
        } else {
          const label = doc.createElement("span");
          label.textContent = t(item.labelKey);
          row.appendChild(label);
        }
      }

      const upBtn = doc.createElement("button");
      upBtn.type = "button";
      upBtn.className = "btn-link";
      upBtn.textContent = "▲";
      upBtn.disabled = index === 0;
      upBtn.dataset.footerOrderEntry = entryId;
      upBtn.dataset.footerOrderMove = "up";
      row.appendChild(upBtn);
      const downBtn = doc.createElement("button");
      downBtn.type = "button";
      downBtn.className = "btn-link";
      downBtn.textContent = "▼";
      downBtn.disabled = index === order.length - 1;
      downBtn.dataset.footerOrderEntry = entryId;
      downBtn.dataset.footerOrderMove = "down";
      row.appendChild(downBtn);

      list.appendChild(row);
    });
  }
  renderFooterSettings();

  el("footer-settings-list")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-footer-item-key]");
    if (checkbox) {
      setFooterItemVisible(checkbox.dataset.footerItemKey, checkbox.checked);
      applyFooterSettings(doc);
      return;
    }
    const textarea = event.target.closest("[data-footer-block-id]");
    if (textarea) {
      setCustomBlockHtml(textarea.dataset.footerBlockId, textarea.value);
      applyFooterSettings(doc);
    }
  });
  el("footer-settings-list")?.addEventListener("click", (event) => {
    const moveBtn = event.target.closest("[data-footer-order-move]");
    if (moveBtn) {
      moveFooterEntry(moveBtn.dataset.footerOrderEntry, moveBtn.dataset.footerOrderMove);
      applyFooterSettings(doc);
      renderFooterSettings();
      return;
    }
    const removeBtn = event.target.closest("[data-remove-footer-block-id]");
    if (removeBtn) {
      if (!doc.defaultView.confirm(t("footerSettings.confirmRemoveBlock"))) return;
      removeCustomBlock(removeBtn.dataset.removeFooterBlockId);
      applyFooterSettings(doc);
      renderFooterSettings();
    }
  });
  el("btn-add-footer-custom-block")?.addEventListener("click", () => {
    // Exec review finding 3 (specs/reviews/footer-customization-FC3-iter1.md):
    // addCustomBlock() returns null when persistence failed (FC1 -- e.g.
    // storage quota exceeded, reachable since custom HTML has no size
    // limit by design). Previously the return value was discarded, so the
    // button silently did nothing with zero feedback on failure.
    const status = el("footer-settings-status");
    if (addCustomBlock() === null) {
      if (status) status.textContent = t("footerSettings.addBlockFailed");
      return;
    }
    if (status) status.textContent = "";
    applyFooterSettings(doc);
    renderFooterSettings();
  });
  el("btn-reset-footer-settings")?.addEventListener("click", () => {
    resetFooterSettings();
    applyFooterSettings(doc);
    renderFooterSettings();
  });

  // Section GE3 (specs/ui/granular-feature-flags.md): per-route toggles on
  // top of the master unlock -- structurally like renderSettingsRegistry
  // above (one row per registry entry), but no order/per-item-reset: this
  // isn't a visible list to sequence, it's an access-control list, and one
  // shared "Скинути" button (below) is enough, same as design settings'
  // resetAllDesignSettings. No re-render/router notification needed on
  // toggle -- this panel only lives on the "server" screen, which can never
  // be the SAME screen a just-toggled route refers to.
  function renderFeatureFlagsSettings() {
    const list = el("feature-flags-list");
    if (!list) return;
    list.innerHTML = "";
    for (const key of TOGGLEABLE_FEATURE_KEYS) {
      const entry = ADVANCED_FEATURES.find((f) => f.key === key);
      const row = doc.createElement("div");
      row.className = "settings-row";
      row.dataset.featureKey = key;
      const label = doc.createElement("label");
      label.className = "field";
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isFeatureEnabled(key);
      checkbox.dataset.featureToggleKey = key;
      label.appendChild(checkbox);
      const labelText = doc.createElement("span");
      labelText.textContent = entry?.labelKey ? t(entry.labelKey) : key;
      label.appendChild(labelText);
      row.appendChild(label);
      list.appendChild(row);
    }
  }
  renderFeatureFlagsSettings();

  el("feature-flags-list")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-feature-toggle-key]");
    if (!checkbox) return;
    setFeatureEnabled(checkbox.dataset.featureToggleKey, checkbox.checked);
  });
  el("btn-reset-feature-flags")?.addEventListener("click", () => {
    resetFeatureFlags();
    renderFeatureFlagsSettings();
  });

  return { renderSettingsRegistry, renderDesignSettings, renderFooterSettings, renderFeatureFlagsSettings };
}
