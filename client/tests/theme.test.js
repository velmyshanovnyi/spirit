// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTheme, toggleTheme } from "../js/theme.js";

function stubPrefersDark(prefersDark) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes("dark") ? prefersDark : !prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("initTheme", () => {
  it("applies the stored theme when one was saved", () => {
    stubPrefersDark(false);
    localStorage.setItem("spirit.theme", "dark");

    initTheme(document);

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("falls back to the OS preference when nothing is stored", () => {
    stubPrefersDark(true);
    initTheme(document);
    expect(document.documentElement.dataset.theme).toBe("dark");

    stubPrefersDark(false);
    initTheme(document);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("toggleTheme", () => {
  it("switches between light and dark and persists the choice", () => {
    stubPrefersDark(false);
    initTheme(document);
    expect(document.documentElement.dataset.theme).toBe("light");

    toggleTheme(document);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("spirit.theme")).toBe("dark");

    toggleTheme(document);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("spirit.theme")).toBe("light");
  });
});
