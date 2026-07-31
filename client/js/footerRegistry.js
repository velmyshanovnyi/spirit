/**
 * Section FC1 (specs/ui/footer-customization.md): footer item visibility/
 * order + user-defined custom HTML blocks. Same localStorage-only, per-
 * device design principle as designSettingsRegistry.js, but a dedicated
 * module rather than shoehorned into that registry -- designSettingsRegistry's
 * `type: "order"` assumes a FIXED, compile-time-known item list; custom
 * blocks are a dynamic, user-managed list (add/remove at runtime), which
 * doesn't fit that shape.
 */

const STORAGE_ITEMS_VISIBLE = "spirit.footer.itemsVisible";
const STORAGE_CUSTOM_BLOCKS = "spirit.footer.customBlocks";
const STORAGE_ORDER = "spirit.footer.order";

export const FOOTER_ITEMS = [
  { key: "license", labelKey: "footerSettings.item.license", selector: "#footer-license-link" },
  { key: "github", labelKey: "footerSettings.item.github", selector: "#footer-github-link" },
  { key: "docs", labelKey: "footerSettings.item.docs", selector: "#footer-docs-link" },
  { key: "version", labelKey: "footerSettings.item.version", selector: ".footer-version" },
  { key: "advancedToggle", labelKey: "footerSettings.item.advancedToggle", selector: "#footer-advanced-toggle" }
];
const FOOTER_ITEM_KEYS = FOOTER_ITEMS.map((item) => item.key);

// Exec review findings 3+4 (specs/reviews/footer-customization-FC1-iter1.md):
// the original readJSON only guarded PARSE failures via try/catch -- a
// value that parses successfully but to the wrong SHAPE (e.g. the literal
// string "null", which is valid JSON for `null`) sailed straight past the
// fallback and crashed every caller that assumed an object/array. Both
// helpers below take an explicit shape validator so the fallback covers
// "wrong shape" the same way it already covered "parse error".
function readJSON(key, fallback, isValidShape) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    return isValidShape(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns false (write failed/unavailable) instead of throwing -- callers decide what "failed" means for them. */
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // A full/unavailable localStorage just means this doesn't persist --
    // the CALLER decides whether that's fatal (e.g. addCustomBlock treats
    // it as "creation failed"), not this generic helper.
    return false;
  }
}

export function isFooterItemVisible(key) {
  const stored = readJSON(STORAGE_ITEMS_VISIBLE, {}, isPlainObject);
  return stored[key] !== false;
}

export function setFooterItemVisible(key, visible) {
  const stored = readJSON(STORAGE_ITEMS_VISIBLE, {}, isPlainObject);
  stored[key] = visible;
  writeJSON(STORAGE_ITEMS_VISIBLE, stored);
}

export function listCustomBlocks() {
  const blocks = readJSON(STORAGE_CUSTOM_BLOCKS, [], Array.isArray);
  // Exec review finding 3 follow-up: also drop individual malformed entries
  // (missing/non-string id) rather than letting a partially-corrupt array
  // through -- every caller keys blocks by `.id`.
  return blocks.filter((b) => b && typeof b === "object" && typeof b.id === "string");
}

function writeCustomBlocks(blocks) {
  return writeJSON(STORAGE_CUSTOM_BLOCKS, blocks);
}

function randomBlockId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns the new block's id, or `null` if persistence failed (e.g. quota
 * exceeded -- reachable in practice since custom HTML has no size limit by
 * design, see spec). Exec review finding 1: previously returned an id
 * unconditionally, so a caller couldn't tell "created" from "nothing was
 * actually saved" -- the block would silently vanish on reload.
 */
export function addCustomBlock() {
  const blocks = listCustomBlocks();
  const id = randomBlockId();
  blocks.push({ id, html: "" });
  if (!writeCustomBlocks(blocks)) return null;
  // getFooterOrder()'s reconciliation already appends any valid entry
  // missing from the stored order -- this new block is exactly that,
  // whether there was a stored order yet or not (defaultOrder() reads
  // listCustomBlocks() fresh, so it already includes this block too).
  // Manually pushing here as well would duplicate the entry.
  setFooterOrder(getFooterOrder());
  return id;
}

export function setCustomBlockHtml(id, html) {
  const blocks = listCustomBlocks();
  const block = blocks.find((b) => b.id === id);
  if (!block) return false;
  block.html = html;
  writeCustomBlocks(blocks);
  return true;
}

export function removeCustomBlock(id) {
  writeCustomBlocks(listCustomBlocks().filter((b) => b.id !== id));
  setFooterOrder(getFooterOrder().filter((entryId) => entryId !== `custom:${id}`));
}

function defaultOrder() {
  return [...FOOTER_ITEM_KEYS, ...listCustomBlocks().map((b) => `custom:${b.id}`)];
}

/**
 * The single combined sequence of fixed items + custom blocks. Reconciles
 * a stored order against CURRENT reality on every read: drops entries
 * whose target no longer exists (a deleted custom block), appends
 * anything valid that's missing from the stored list (a newly added
 * custom block, or -- forward-compatibility -- a fixed item added to
 * FOOTER_ITEMS by a future code change after this order was saved).
 */
export function getFooterOrder() {
  const stored = readJSON(STORAGE_ORDER, null, Array.isArray);
  if (!stored) return defaultOrder();
  const validEntries = new Set([...FOOTER_ITEM_KEYS, ...listCustomBlocks().map((b) => `custom:${b.id}`)]);
  const filtered = stored.filter((entry) => validEntries.has(entry));
  const missing = [...validEntries].filter((entry) => !filtered.includes(entry));
  return [...filtered, ...missing];
}

export function setFooterOrder(order) {
  writeJSON(STORAGE_ORDER, order);
}

export function moveFooterEntry(entryId, direction) {
  const order = getFooterOrder();
  const index = order.indexOf(entryId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= order.length) return;
  const next = [...order];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  setFooterOrder(next);
}

/** Clears visibility+order overrides. Deliberately does NOT delete custom block content -- see spec. */
export function resetFooterSettings() {
  try {
    localStorage.removeItem(STORAGE_ITEMS_VISIBLE);
    localStorage.removeItem(STORAGE_ORDER);
  } catch {
    // Best-effort, same reasoning as writeJSON.
  }
}

const CUSTOM_BLOCK_ID_ATTR = "footerBlockId";

/**
 * Section FC2 (specs/ui/footer-customization.md): renders the combined
 * order onto the live footer -- fixed items get the SAME `style.order`
 * flex-reordering trick applyDesignSettings() already uses for
 * headerControlsOrder (no DOM reparenting, static HTML stays put) plus a
 * `hidden` toggle for visibility; custom blocks get their own
 * dynamically-created/updated/removed `<div>` with raw `innerHTML`. Call
 * once at startup and again after any footer-settings change.
 */
export function applyFooterSettings(doc) {
  const footer = doc.getElementById("app-footer");
  if (!footer) return;

  const order = getFooterOrder();
  const blocks = listCustomBlocks();
  const blocksById = new Map(blocks.map((b) => [b.id, b]));

  order.forEach((entryId, index) => {
    if (entryId.startsWith("custom:")) {
      const id = entryId.slice("custom:".length);
      const block = blocksById.get(id);
      if (!block) return; // reconciled order shouldn't reference a missing block, but stay defensive
      // Exec review finding 5: :scope > restricts the lookup (and the
      // sweep below) to DIRECT children of the footer -- a custom block's
      // OWN user-authored innerHTML could itself contain an element
      // carrying a data-footer-block-id-shaped attribute (self-inflicted
      // only, consistent with this feature's accepted trust model, but
      // cheap to exclude from ever being mistaken for a registry-managed
      // node).
      let node = footer.querySelector(`:scope > [data-${toDatasetSelector(CUSTOM_BLOCK_ID_ATTR)}="${cssEscape(id)}"]`);
      if (!node) {
        node = doc.createElement("div");
        node.className = "footer-custom-block";
        node.dataset[CUSTOM_BLOCK_ID_ATTR] = id;
        footer.appendChild(node);
      }
      // Exec review finding 2: comparing against node.innerHTML (the
      // browser's re-serialized, normalized form -- e.g. single quotes
      // become double, attribute order/spacing can change) is NOT the
      // same as comparing against the source string that was actually
      // assigned -- a block whose stored HTML hasn't changed at all could
      // still fail that comparison on every single render, destroying and
      // rebuilding its subtree and losing any live state inside it (an
      // in-progress form field, focus, a running <video>, etc.). Track the
      // last-assigned SOURCE string as a plain JS property on the node
      // (not a DOM attribute -- avoids any HTML-attribute-encoding size/
      // escaping concerns for arbitrarily large custom HTML).
      if (node.__footerBlockSource !== block.html) {
        node.innerHTML = block.html;
        node.__footerBlockSource = block.html;
      }
      node.style.order = String(index);
      return;
    }
    const item = FOOTER_ITEMS.find((i) => i.key === entryId);
    if (!item) return;
    for (const node of footer.querySelectorAll(item.selector)) {
      node.style.order = String(index);
      // Exec review finding 1 (specs/reviews/footer-customization-FC2-iter1.md):
      // "advancedToggle" is deliberately ALWAYS visible, order-only --
      // it's the only UI path back into the app once advanced mode is
      // locked (index.html's own comment on this element). Letting a
      // stored "hidden" preference apply to it would let a user lock
      // themselves out with no way back short of editing localStorage by
      // hand.
      if (item.key !== "advancedToggle") {
        node.hidden = !isFooterItemVisible(item.key);
      }
    }
  });

  // Sweep away custom-block DOM nodes for blocks that no longer exist
  // (deleted since the last render).
  for (const node of footer.querySelectorAll(`:scope > [data-${toDatasetSelector(CUSTOM_BLOCK_ID_ATTR)}]`)) {
    if (!blocksById.has(node.dataset[CUSTOM_BLOCK_ID_ATTR])) node.remove();
  }
}

function toDatasetSelector(camelCaseAttr) {
  return camelCaseAttr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function cssEscape(value) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
