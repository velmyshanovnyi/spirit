/**
 * Section RF13 (specs/ui/settings-panel.md), Stage 1: a typed registry of
 * previously-hardcoded tunable parameters, persisted to localStorage the
 * same device-level way as spirit.theme/spirit.folders/spirit.floatingVideoRect
 * -- NOT tied to an account/profile. Each entry describes itself (label +
 * description) so the settings UI can render structurally instead of
 * hand-maintaining a separate description per field.
 *
 * Deliberately excluded (see the spec for the full rationale): values that
 * already have their own dedicated UI (server/STUN/TURN, language, theme),
 * and cryptographic/protocol constants where a user-tunable value would
 * either break server compatibility (POW_DIFFICULTY_BITS/WINDOW_SECONDS) or
 * silently weaken the user's own security (PBKDF2/Argon2id parameters,
 * clock-skew tolerances, salt/IV lengths).
 */

const STORAGE_PREFIX = "spirit.settings.";

// Section C6 (specs/reviews/spirit-evaluation-triage.md): label/description
// used to be hardcoded Ukrainian literals baked into this registry --
// unreachable from the language switcher regardless of the user's chosen
// locale. Every entry now carries labelKey/descriptionKey pointing into
// i18n.js's MESSAGES (settings.<key>.label / settings.<key>.description);
// renderSettingsRegistry() in app.js resolves them via t() at render time.
export const SETTINGS = [
  {
    key: "iceTimeoutMs",
    category: "connection",
    labelKey: "settings.iceTimeoutMs.label",
    descriptionKey: "settings.iceTimeoutMs.description",
    type: "number",
    default: 15000,
    min: 1000,
    max: 120000
  },
  {
    key: "answerWaitTimeoutMs",
    category: "connection",
    labelKey: "settings.answerWaitTimeoutMs.label",
    descriptionKey: "settings.answerWaitTimeoutMs.description",
    type: "number",
    default: 5 * 60 * 1000,
    min: 5000,
    max: 30 * 60 * 1000
  },
  {
    key: "proofRecheckIntervalMs",
    category: "identity",
    labelKey: "settings.proofRecheckIntervalMs.label",
    descriptionKey: "settings.proofRecheckIntervalMs.description",
    type: "number",
    default: 24 * 60 * 60 * 1000,
    min: 60 * 1000,
    max: 7 * 24 * 60 * 60 * 1000
  },
  {
    key: "proofFailureThreshold",
    category: "identity",
    labelKey: "settings.proofFailureThreshold.label",
    descriptionKey: "settings.proofFailureThreshold.description",
    type: "number",
    default: 3,
    min: 1,
    max: 20
  },
  {
    key: "fileSizeWarningBytes",
    category: "fileTransfer",
    labelKey: "settings.fileSizeWarningBytes.label",
    descriptionKey: "settings.fileSizeWarningBytes.description",
    type: "number",
    default: 100 * 1024 * 1024,
    min: 1024 * 1024,
    max: 2 * 1024 * 1024 * 1024
  },
  {
    key: "fileChunkSize",
    category: "fileTransfer",
    labelKey: "settings.fileChunkSize.label",
    descriptionKey: "settings.fileChunkSize.description",
    type: "number",
    default: 16 * 1024,
    min: 4 * 1024,
    max: 256 * 1024
  },
  {
    key: "bufferedAmountHighThresholdBytes",
    category: "fileTransfer",
    labelKey: "settings.bufferedAmountHighThresholdBytes.label",
    descriptionKey: "settings.bufferedAmountHighThresholdBytes.description",
    type: "number",
    default: 1024 * 1024,
    min: 64 * 1024,
    max: 16 * 1024 * 1024
  },
  {
    key: "maxRecentAccounts",
    category: "accounts",
    labelKey: "settings.maxRecentAccounts.label",
    descriptionKey: "settings.maxRecentAccounts.description",
    type: "number",
    default: 10,
    min: 1,
    max: 50
  },
  {
    key: "floatingVideoDefaultWidth",
    category: "ui",
    labelKey: "settings.floatingVideoDefaultWidth.label",
    descriptionKey: "settings.floatingVideoDefaultWidth.description",
    type: "number",
    default: 320,
    min: 160,
    max: 1200
  },
  {
    key: "floatingVideoDefaultHeight",
    category: "ui",
    labelKey: "settings.floatingVideoDefaultHeight.label",
    descriptionKey: "settings.floatingVideoDefaultHeight.description",
    type: "number",
    default: 240,
    min: 120,
    max: 1000
  },
  {
    key: "pushTtlSeconds",
    category: "notifications",
    labelKey: "settings.pushTtlSeconds.label",
    descriptionKey: "settings.pushTtlSeconds.description",
    type: "number",
    default: 86400,
    min: 60,
    max: 7 * 24 * 60 * 60
  }
];

const SETTINGS_BY_KEY = new Map(SETTINGS.map((entry) => [entry.key, entry]));

function readRaw(key) {
  try {
    return localStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

/** Returns the stored value for `key`, or its default if unset/invalid. */
export function getSetting(key) {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`settingsRegistry: unknown setting "${key}"`);
  const raw = readRaw(key);
  if (raw === null) return def.default;
  if (def.type === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < def.min || parsed > def.max) return def.default;
    return parsed;
  }
  return raw;
}

/** Validates and persists `value` for `key`. Returns false (no-op) if invalid. */
export function setSetting(key, value) {
  const def = SETTINGS_BY_KEY.get(key);
  if (!def) throw new Error(`settingsRegistry: unknown setting "${key}"`);
  let toStore = value;
  if (def.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < def.min || parsed > def.max) return false;
    toStore = parsed;
  }
  try {
    localStorage.setItem(STORAGE_PREFIX + key, String(toStore));
  } catch {
    // Best-effort only -- a full/unavailable localStorage just means this
    // change doesn't persist across reloads, not a functional break.
  }
  return true;
}

/** Removes the override for `key`, reverting it to its default. */
export function resetSetting(key) {
  if (!SETTINGS_BY_KEY.has(key)) throw new Error(`settingsRegistry: unknown setting "${key}"`);
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Best-effort, same reasoning as setSetting.
  }
}

/** Resets every registered setting back to its default. */
export function resetAllSettings() {
  for (const entry of SETTINGS) resetSetting(entry.key);
}
