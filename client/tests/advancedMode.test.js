// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../js/adminAuth.js", () => ({
  adminLogin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {}
}));

import { adminLogin, AdminAuthError } from "../js/adminAuth.js";
import { isAdvancedModeUnlocked, unlockAdvancedMode, lockAdvancedMode } from "../js/advancedMode.js";

const BASE_URL = "http://node.example/index.php";
const STORAGE_KEY = "spirit.advancedModeUnlocked";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("isAdvancedModeUnlocked", () => {
  it("defaults to false when nothing is stored", () => {
    expect(isAdvancedModeUnlocked()).toBe(false);
  });

  it("returns true when the flag is set", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    expect(isAdvancedModeUnlocked()).toBe(true);
  });

  it("fails closed to false when storage throws (private mode / blocked storage)", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isAdvancedModeUnlocked()).toBe(false);
    getItemSpy.mockRestore();
  });
});

describe("unlockAdvancedMode", () => {
  it("calls adminLogin for validation only, sets the flag, and returns true on success", async () => {
    adminLogin.mockResolvedValue({ token: "abc.def", expiresAt: 12345 });

    const result = await unlockAdvancedMode(BASE_URL, "correct horse");

    expect(adminLogin).toHaveBeenCalledWith(BASE_URL, "correct horse");
    expect(result).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("does not touch storage and rethrows on a wrong password", async () => {
    adminLogin.mockRejectedValue(new AdminAuthError("Invalid or expired admin credentials"));

    await expect(unlockAdvancedMode(BASE_URL, "wrong")).rejects.toThrow(AdminAuthError);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("throws a plain (non-AdminAuthError) error when the password was correct but storage is unavailable", async () => {
    adminLogin.mockResolvedValue({ token: "abc.def", expiresAt: 12345 });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    let caught = null;
    try {
      await unlockAdvancedMode(BASE_URL, "correct horse");
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    expect(caught).not.toBeInstanceOf(AdminAuthError);
    setItemSpy.mockRestore();
  });
});

describe("lockAdvancedMode", () => {
  it("removes the flag", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    lockAdvancedMode();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(isAdvancedModeUnlocked()).toBe(false);
  });
});
