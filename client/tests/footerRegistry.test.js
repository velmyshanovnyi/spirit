// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FOOTER_ITEMS,
  isFooterItemVisible,
  setFooterItemVisible,
  listCustomBlocks,
  addCustomBlock,
  setCustomBlockHtml,
  removeCustomBlock,
  getFooterOrder,
  setFooterOrder,
  moveFooterEntry,
  resetFooterSettings
} from "../js/footerRegistry.js";

beforeEach(() => {
  localStorage.clear();
});

describe("isFooterItemVisible / setFooterItemVisible", () => {
  it("defaults to visible for every registered fixed item", () => {
    for (const item of FOOTER_ITEMS) {
      expect(isFooterItemVisible(item.key)).toBe(true);
    }
  });

  it("persists an explicit hide/show", () => {
    setFooterItemVisible("license", false);
    expect(isFooterItemVisible("license")).toBe(false);
    setFooterItemVisible("license", true);
    expect(isFooterItemVisible("license")).toBe(true);
  });

  // Exec review finding 4: readJSON's fallback only covers a MISSING key or
  // a PARSE failure -- "null" parses successfully to `null`, a value whose
  // shape is wrong but which is not a parse error, so the {} fallback was
  // never reached and stored[key] threw.
  it("does not throw when the stored value parses to something other than an object", () => {
    localStorage.setItem("spirit.footer.itemsVisible", "null");
    expect(() => isFooterItemVisible("license")).not.toThrow();
    expect(isFooterItemVisible("license")).toBe(true); // fails safe: treated as unset -- visible
    expect(() => setFooterItemVisible("license", false)).not.toThrow();
  });
});

describe("custom blocks CRUD", () => {
  it("starts empty", () => {
    expect(listCustomBlocks()).toEqual([]);
  });

  // Exec review finding 3: same "readJSON only guards parse errors, not
  // shape" root cause as finding 4 above -- listCustomBlocks() has no
  // fallback for a legitimately-parsed non-array value, and getFooterOrder
  // (and addCustomBlock) call .map()/.push() on whatever it returns
  // unguarded.
  it("returns an empty array (not a crash) when the stored value isn't an array", () => {
    localStorage.setItem("spirit.footer.customBlocks", "null");
    expect(listCustomBlocks()).toEqual([]);
    expect(() => getFooterOrder()).not.toThrow();
    expect(() => addCustomBlock()).not.toThrow();
  });

  it("filters out malformed entries (missing/non-string id) rather than crashing on them later", () => {
    localStorage.setItem("spirit.footer.customBlocks", JSON.stringify([{ id: "real-1", html: "" }, { html: "no id" }, "not even an object"]));
    const blocks = listCustomBlocks();
    expect(blocks).toEqual([{ id: "real-1", html: "" }]);
  });

  // Exec review finding 1: addCustomBlock used to return an id
  // unconditionally, even when the underlying write silently failed
  // (writeJSON's try/catch swallows quota errors) -- the caller had no way
  // to tell "created" apart from "nothing was persisted", and the block
  // would vanish on reload while still LOOKING created in the UI.
  it("returns null (not a phantom id) when persistence fails", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const id = addCustomBlock();
    setItemSpy.mockRestore();
    expect(id).toBeNull();
    expect(listCustomBlocks()).toEqual([]);
  });

  it("addCustomBlock creates an empty block, returns its id, and appends it to the order", () => {
    const id = addCustomBlock();
    const blocks = listCustomBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ id, html: "" });
    expect(getFooterOrder().at(-1)).toBe(`custom:${id}`);
  });

  it("setCustomBlockHtml updates the block's content", () => {
    const id = addCustomBlock();
    expect(setCustomBlockHtml(id, "<b>hi</b>")).toBe(true);
    expect(listCustomBlocks()[0].html).toBe("<b>hi</b>");
  });

  it("setCustomBlockHtml on a non-existent id returns false", () => {
    expect(setCustomBlockHtml("nope", "<b>hi</b>")).toBe(false);
  });

  it("removeCustomBlock deletes the block AND its order entry", () => {
    const id1 = addCustomBlock();
    const id2 = addCustomBlock();
    removeCustomBlock(id1);
    expect(listCustomBlocks().map((b) => b.id)).toEqual([id2]);
    expect(getFooterOrder()).not.toContain(`custom:${id1}`);
    expect(getFooterOrder()).toContain(`custom:${id2}`);
  });
});

describe("getFooterOrder", () => {
  it("defaults to the fixed items in registry order when nothing is stored", () => {
    expect(getFooterOrder()).toEqual(FOOTER_ITEMS.map((i) => i.key));
  });

  it("appends existing custom blocks after the fixed items when no order is stored yet", () => {
    const id = addCustomBlock(); // this itself sets an order, so test the raw default path separately
    localStorage.removeItem("spirit.footer.order");
    expect(getFooterOrder()).toEqual([...FOOTER_ITEMS.map((i) => i.key), `custom:${id}`]);
  });

  it("returns a manually saved order as-is when everything in it is still valid", () => {
    const custom = [...FOOTER_ITEMS.map((i) => i.key)].reverse();
    setFooterOrder(custom);
    expect(getFooterOrder()).toEqual(custom);
  });

  // Exec review finding 2 (specs/reviews/footer-customization-FC1-iter1.md):
  // this test used to route the deletion through removeCustomBlock(), which
  // ITSELF already strips the stale order entry -- so getFooterOrder()'s own
  // reconciliation filter (the thing actually under test) was never
  // exercised; a mutation that deleted that filter entirely still passed
  // the whole suite. This writes a stale/"ghost" entry directly into
  // storage that NOTHING else ever cleans up, so only getFooterOrder()'s
  // own filtering can be responsible for it disappearing.
  it("filters out a ghost order entry that was never a real block (read-time reconciliation, not delete-time cleanup)", () => {
    const order = getFooterOrder();
    setFooterOrder([...order, "custom:ghost-never-existed"]);
    expect(getFooterOrder()).not.toContain("custom:ghost-never-existed");
  });

  it("drops entries for a deleted custom block and appends anything newly missing", () => {
    const id = addCustomBlock();
    // Simulate a stale saved order that still references a since-deleted block
    // AND is missing one of the real fixed items (as if a future code update
    // added a new registry entry after this order was saved).
    setFooterOrder([`custom:${id}`, "license", "github"]);
    removeCustomBlock(id);
    const reconciled = getFooterOrder();
    expect(reconciled).not.toContain(`custom:${id}`);
    expect(reconciled).toContain("license");
    expect(reconciled).toContain("github");
    // Every currently-valid entry must appear exactly once.
    const expectedSet = new Set(FOOTER_ITEMS.map((i) => i.key));
    expect(new Set(reconciled)).toEqual(expectedSet);
    expect(reconciled.length).toBe(expectedSet.size);
  });
});

describe("moveFooterEntry", () => {
  it("swaps a fixed item up/down within the combined order", () => {
    const order = getFooterOrder();
    const [first, second] = order;
    moveFooterEntry(second, "up");
    const next = getFooterOrder();
    expect(next[0]).toBe(second);
    expect(next[1]).toBe(first);
  });

  it("moves a custom block above a fixed item and back", () => {
    const id = addCustomBlock();
    moveFooterEntry(`custom:${id}`, "up");
    let order = getFooterOrder();
    const movedIndex = order.indexOf(`custom:${id}`);
    expect(movedIndex).toBe(order.length - 2); // one step up from the very end

    moveFooterEntry(`custom:${id}`, "down");
    order = getFooterOrder();
    expect(order.at(-1)).toBe(`custom:${id}`);
  });

  it("is a no-op at the boundaries", () => {
    const before = getFooterOrder();
    moveFooterEntry(before[0], "up");
    expect(getFooterOrder()).toEqual(before);
    moveFooterEntry(before.at(-1), "down");
    expect(getFooterOrder()).toEqual(before);
  });

  it("is a no-op for an entry not present in the order", () => {
    const before = getFooterOrder();
    moveFooterEntry("custom:nonexistent", "up");
    expect(getFooterOrder()).toEqual(before);
  });
});

describe("resetFooterSettings", () => {
  it("clears visibility and order overrides but keeps custom block content", () => {
    setFooterItemVisible("license", false);
    const id = addCustomBlock();
    setCustomBlockHtml(id, "<p>keep me</p>");
    setFooterOrder(["github", "license", `custom:${id}`]);

    resetFooterSettings();

    expect(isFooterItemVisible("license")).toBe(true);
    expect(getFooterOrder()).toEqual([...FOOTER_ITEMS.map((i) => i.key), `custom:${id}`]);
    expect(listCustomBlocks()).toEqual([{ id, html: "<p>keep me</p>" }]);
  });
});
