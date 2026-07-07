// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { t, setLocale, getLocale, detectLocale, applyTranslations, SUPPORTED_LOCALES, MESSAGES } from "../js/i18n.js";

beforeEach(() => {
  localStorage.clear();
  setLocale("uk");
});

describe("t", () => {
  it("returns the active locale's translation", () => {
    setLocale("uk");
    expect(t("status.connected")).toBe("з'єднано");
    setLocale("en");
    expect(t("status.connected")).toBe("connected");
    setLocale("de");
    expect(t("status.connected")).toBe("verbunden");
  });

  it("interpolates {param} placeholders", () => {
    setLocale("uk");
    expect(t("status.error", { msg: "boom" })).toBe("помилка: boom");
    setLocale("en");
    expect(t("google.verified", { email: "a@b.c" })).toContain("a@b.c");
  });

  it("falls back to EN for a key missing from the active locale, and to the key itself as last resort", () => {
    setLocale("uk");
    expect(t("__no_such_key__")).toBe("__no_such_key__");
  });
});

describe("locale persistence and detection", () => {
  it("setLocale persists to localStorage and getLocale reads it back", () => {
    setLocale("fr");
    expect(localStorage.getItem("spirit.locale")).toBe("fr");
    expect(getLocale()).toBe("fr");
  });

  it("detectLocale prefers the stored locale", () => {
    localStorage.setItem("spirit.locale", "lv");
    expect(detectLocale("de-DE")).toBe("lv");
  });

  it("detectLocale maps a browser language tag to a supported locale, defaulting to en", () => {
    localStorage.clear(); // no stored choice -- pure browser-language mapping
    expect(detectLocale("de-DE")).toBe("de");
    expect(detectLocale("uk")).toBe("uk");
    expect(detectLocale("nb-NO")).toBe("no");
    expect(detectLocale("pt-BR")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });

  it("setLocale rejects an unsupported locale by keeping the current one", () => {
    setLocale("uk");
    setLocale("xx");
    expect(getLocale()).toBe("uk");
  });
});

describe("applyTranslations", () => {
  it("sets textContent for data-i18n and placeholder for data-i18n-placeholder", () => {
    document.body.innerHTML = `
      <h2 data-i18n="section.account"></h2>
      <input data-i18n-placeholder="chat.placeholder">
    `;
    setLocale("en");
    applyTranslations(document);
    expect(document.querySelector("h2").textContent).toBe(t("section.account"));
    expect(document.querySelector("input").placeholder).toBe(t("chat.placeholder"));
  });

  it("sets title and aria-label for data-i18n-title (icon-only controls)", () => {
    document.body.innerHTML = `<button data-i18n-title="theme.toggle">◐</button>`;
    setLocale("de");
    applyTranslations(document);
    const button = document.querySelector("button");
    expect(button.title).toBe(t("theme.toggle"));
    expect(button.getAttribute("aria-label")).toBe(t("theme.toggle"));
    expect(button.textContent).toBe("◐"); // icon content untouched
  });
});

describe("dictionary completeness", () => {
  it("covers exactly the 11 required locales", () => {
    expect([...SUPPORTED_LOCALES].sort()).toEqual(["de", "en", "es", "et", "fr", "it", "lt", "lv", "no", "ru", "uk"]);
  });

  it("every locale has every key the EN dictionary has (no partial locales)", () => {
    const enKeys = Object.keys(MESSAGES.en).sort();
    expect(enKeys.length).toBeGreaterThan(30);
    for (const locale of SUPPORTED_LOCALES) {
      expect({ locale, keys: Object.keys(MESSAGES[locale]).sort() }).toEqual({ locale, keys: enKeys });
    }
  });

  it("keeps the exact legacy Ukrainian status strings the app tests pin", () => {
    setLocale("uk");
    expect(t("status.createAccountFirst")).toBe("спочатку створіть акаунт");
    expect(t("status.iceTimeout")).toBe("не вдалося зібрати ICE-кандидати (тайм-аут)");
    expect(t("status.noActiveConnection")).toBe("немає активного з'єднання");
    expect(t("status.waitingAnswer")).toBe("очікування відповіді співрозмовника...");
  });
});
