import { getSetting, setSetting, resetSetting, resetAllSettings, SETTINGS } from "./settingsRegistry.js";
import {
  DESIGN_SETTINGS,
  getDesignSetting,
  setDesignSetting,
  resetDesignSetting,
  resetAllDesignSettings,
  applyDesignSettings
} from "./designSettingsRegistry.js";

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

  return { renderSettingsRegistry, renderDesignSettings };
}
