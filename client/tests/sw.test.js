// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { parsePushData, buildNotificationOptions, buildJoinUrl, focusOrOpenClient, NOTIFICATION_TAG } from "../sw.js";

describe("parsePushData", () => {
  it("returns { room, token } for a well-formed invite payload", () => {
    expect(parsePushData({ room: "room1", token: "tok1" })).toEqual({ room: "room1", token: "tok1" });
  });

  it("returns null for null/undefined", () => {
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData(undefined)).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parsePushData("just a string")).toBeNull();
    expect(parsePushData(42)).toBeNull();
  });

  it("returns null when room or token is missing, empty, or the wrong type", () => {
    expect(parsePushData({})).toBeNull();
    expect(parsePushData({ room: "room1" })).toBeNull();
    expect(parsePushData({ token: "tok1" })).toBeNull();
    expect(parsePushData({ room: "", token: "tok1" })).toBeNull();
    expect(parsePushData({ room: "room1", token: "" })).toBeNull();
    expect(parsePushData({ room: 123, token: "tok1" })).toBeNull();
  });

  it("ignores extra fields on an otherwise well-formed payload (forward-compatible, doesn't leak them into the result)", () => {
    expect(parsePushData({ room: "room1", token: "tok1", somethingElse: "x" })).toEqual({
      room: "room1",
      token: "tok1"
    });
  });
});

describe("buildNotificationOptions", () => {
  it("carries the invite through as notification data, with a stable tag", () => {
    const options = buildNotificationOptions({ room: "room1", token: "tok1" });
    expect(options.data).toEqual({ room: "room1", token: "tok1" });
    expect(options.tag).toBe(NOTIFICATION_TAG);
    expect(typeof options.body).toBe("string");
    expect(options.body.length).toBeGreaterThan(0);
  });

  it("uses the same tag for every call, so a second push replaces the first rather than stacking", () => {
    const a = buildNotificationOptions({ room: "a", token: "a" });
    const b = buildNotificationOptions({ room: "b", token: "b" });
    expect(a.tag).toBe(b.tag);
  });
});

describe("buildJoinUrl", () => {
  it("matches Section F4's existing zero-click auto-join query-param contract", () => {
    expect(buildJoinUrl({ room: "room1", token: "tok1" })).toBe("/?room=room1&token=tok1#/room");
  });

  it("URL-encodes room/token values that need it", () => {
    expect(buildJoinUrl({ room: "a b", token: "c&d" })).toBe("/?room=a%20b&token=c%26d#/room");
  });
});

describe("focusOrOpenClient", () => {
  it("focuses (and navigates) an already-open window client instead of opening a new one", async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const focus = vi.fn().mockResolvedValue(undefined);
    const client = { url: "https://spirit.example/", focus, navigate };
    const clientsApi = { openWindow: vi.fn() };

    await focusOrOpenClient([client], "/?room=r&token=t#/room", clientsApi);

    expect(navigate).toHaveBeenCalledWith("/?room=r&token=t#/room");
    expect(focus).toHaveBeenCalled();
    expect(clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new window when there is no existing focusable client", async () => {
    const clientsApi = { openWindow: vi.fn().mockResolvedValue(undefined) };

    await focusOrOpenClient([], "/?room=r&token=t#/room", clientsApi);

    expect(clientsApi.openWindow).toHaveBeenCalledWith("/?room=r&token=t#/room");
  });

  it("still focuses a client that has no navigate method (older/partial Client shape), just without navigating it first", async () => {
    const focus = vi.fn().mockResolvedValue(undefined);
    const client = { url: "https://spirit.example/", focus };
    const clientsApi = { openWindow: vi.fn() };

    await focusOrOpenClient([client], "/?room=r&token=t#/room", clientsApi);

    expect(focus).toHaveBeenCalled();
    expect(clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("still focuses the client even when navigate() REJECTS (out-of-scope/already-navigated-away client, exec review finding)", async () => {
    const navigate = vi.fn().mockRejectedValue(new Error("InvalidStateError"));
    const focus = vi.fn().mockResolvedValue(undefined);
    const client = { url: "https://spirit.example/", focus, navigate };
    const clientsApi = { openWindow: vi.fn() };

    await expect(focusOrOpenClient([client], "/?room=r&token=t#/room", clientsApi)).resolves.not.toThrow();

    expect(navigate).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(clientsApi.openWindow).not.toHaveBeenCalled();
  });
});
