// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { rememberSession, getRememberedProfileId, forgetSession } from "../js/session.js";

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
