// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../js/adminAuth.js", () => ({
  adminLogin: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {}
}));

import { adminLogin, AdminAuthError } from "../js/adminAuth.js";
import {
  isAdvancedModeUnlocked,
  unlockAdvancedMode,
  lockAdvancedMode,
  ADVANCED_FEATURES,
  TOGGLEABLE_FEATURE_KEYS,
  isFeatureEnabled,
  setFeatureEnabled,
  resetFeatureFlags
} from "../js/advancedMode.js";

const BASE_URL = "http://node.example/index.php";
const STORAGE_KEY = "spirit.advancedModeUnlocked";
const FEATURE_FLAGS_KEY = "spirit.advancedFeatureFlags";

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

// Section GE1 (specs/ui/granular-feature-flags.md): per-route toggles on top
// of the master password unlock.
describe("ADVANCED_FEATURES / TOGGLEABLE_FEATURE_KEYS", () => {
  it("covers exactly the five advanced routes, with server excluded from the toggleable subset", () => {
    // [...array] before .sort() -- Array.prototype.sort mutates in place,
    // and these are the module's own exported consts (exec review finding 4).
    expect([...ADVANCED_FEATURES.map((f) => f.key)].sort()).toEqual(["history", "manage", "profile", "room", "server"].sort());
    expect(TOGGLEABLE_FEATURE_KEYS).not.toContain("server");
    expect([...TOGGLEABLE_FEATURE_KEYS].sort()).toEqual(["history", "manage", "profile", "room"].sort());
  });
});

describe("isFeatureEnabled / setFeatureEnabled", () => {
  it("defaults every toggleable feature to enabled when nothing is stored", () => {
    for (const key of TOGGLEABLE_FEATURE_KEYS) {
      expect(isFeatureEnabled(key)).toBe(true);
    }
  });

  it("setFeatureEnabled(key, false) then isFeatureEnabled(key) reflects the change, persisted under the documented storage key", () => {
    setFeatureEnabled("profile", false);
    expect(isFeatureEnabled("profile")).toBe(false);
    expect(isFeatureEnabled("room")).toBe(true);
    // Exec review finding 2: a round-trip through the module's own
    // reader/writer alone doesn't prove the storage KEY is right -- a typo'd
    // key would still pass a pure round-trip test.
    expect(JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY))).toEqual({ profile: false });
  });

  it("honors a flag written directly to storage by another code path (e.g. a hand-set localStorage value)", () => {
    // Exec review finding 2: this is the exact read path GE2's own planned
    // regression test depends on (a flag set outside this module's own
    // writer) -- covering it here too, not just via GE2.
    localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify({ profile: false }));
    expect(isFeatureEnabled("profile")).toBe(false);
    expect(isFeatureEnabled("room")).toBe(true);
  });

  it("server is always enabled, even after an explicit attempt to disable it (self-lockout guard)", () => {
    setFeatureEnabled("server", false);
    expect(isFeatureEnabled("server")).toBe(true);
    // The no-op write must not corrupt storage for the OTHER keys either.
    expect(isFeatureEnabled("profile")).toBe(true);
  });

  it("falls back to 'all enabled' when the stored value is valid JSON but the wrong shape", () => {
    localStorage.setItem(FEATURE_FLAGS_KEY, "null");
    expect(isFeatureEnabled("profile")).toBe(true);
  });

  it("fails open (enabled) when storage throws on read", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isFeatureEnabled("profile")).toBe(true);
    getItemSpy.mockRestore();
  });
});

describe("resetFeatureFlags", () => {
  it("clears only the feature-flags key, leaving the master unlock flag untouched", () => {
    // Exec review finding 3: resetFeatureFlags' body sits right next to
    // lockAdvancedMode's near-identical one -- a copy-paste that removed
    // STORAGE_KEY (advancedModeUnlocked) instead of FEATURE_FLAGS_KEY would
    // silently lock the user OUT of advanced mode entirely on "Скинути".
    localStorage.setItem(STORAGE_KEY, "1");
    setFeatureEnabled("profile", false);
    setFeatureEnabled("history", false);

    resetFeatureFlags();

    expect(isFeatureEnabled("profile")).toBe(true);
    expect(isFeatureEnabled("history")).toBe(true);
    expect(isAdvancedModeUnlocked()).toBe(true);
  });
});
