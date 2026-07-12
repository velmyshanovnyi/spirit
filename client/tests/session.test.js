// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { rememberSession, getRememberedProfileId, forgetSession, recordRecentAccount, getRecentAccounts } from "../js/session.js";

beforeEach(() => {
  localStorage.clear();
});

describe("rememberSession / getRememberedProfileId / forgetSession", () => {
  it("returns null when nothing has been remembered", () => {
    expect(getRememberedProfileId()).toBeNull();
  });

  it("remembers a profile id that is retrievable before it expires", () => {
    rememberSession("profile-1", 24);
    const now = Date.now() + 23 * 3600 * 1000;
    expect(getRememberedProfileId(now)).toBe("profile-1");
  });

  it("returns null once the TTL has elapsed", () => {
    rememberSession("profile-1", 24);
    const now = Date.now() + 25 * 3600 * 1000;
    expect(getRememberedProfileId(now)).toBeNull();
  });

  it("forgetSession clears the remembered profile immediately", () => {
    rememberSession("profile-1", 24);
    forgetSession();
    expect(getRememberedProfileId()).toBeNull();
  });

  it("returns null for corrupted localStorage content instead of throwing", () => {
    localStorage.setItem("spirit.session", "{not json");
    expect(getRememberedProfileId()).toBeNull();
  });

  it("a fresh rememberSession call overwrites an earlier remembered profile", () => {
    rememberSession("profile-1", 24);
    rememberSession("profile-2", 24);
    expect(getRememberedProfileId()).toBe("profile-2");
  });
});

describe("recordRecentAccount / getRecentAccounts (browser-wide MRU list)", () => {
  it("returns an empty list when nothing has been used yet", () => {
    expect(getRecentAccounts()).toEqual([]);
  });

  it("records a used account, most-recent first", () => {
    recordRecentAccount("profile-1");
    recordRecentAccount("profile-2");
    expect(getRecentAccounts()).toEqual(["profile-2", "profile-1"]);
  });

  it("moves a re-used account back to the front instead of duplicating it", () => {
    recordRecentAccount("profile-1");
    recordRecentAccount("profile-2");
    recordRecentAccount("profile-1");
    expect(getRecentAccounts()).toEqual(["profile-1", "profile-2"]);
  });

  it("caps the list at 10, dropping the oldest entry", () => {
    for (let i = 1; i <= 11; i++) {
      recordRecentAccount(`profile-${i}`);
    }
    const recent = getRecentAccounts();
    expect(recent.length).toBe(10);
    expect(recent[0]).toBe("profile-11");
    expect(recent).not.toContain("profile-1"); // the oldest, pushed out
  });

  it("returns an empty list for corrupted localStorage content instead of throwing", () => {
    localStorage.setItem("spirit.recentAccounts", "{not json");
    expect(getRecentAccounts()).toEqual([]);
  });
});
