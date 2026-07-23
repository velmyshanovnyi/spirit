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

export const SETTINGS = [
  {
    key: "iceTimeoutMs",
    category: "connection",
    label: "Таймаут ICE-з'єднання (мс)",
    description: "Скільки часу чекати встановлення WebRTC-з'єднання (збір ICE-кандидатів), перш ніж показати помилку.",
    type: "number",
    default: 15000,
    min: 1000,
    max: 120000
  },
  {
    key: "answerWaitTimeoutMs",
    category: "connection",
    label: "Таймаут очікування відповіді (мс)",
    description: "Скільки часу ініціатор чату чекає, поки співрозмовник прийме запрошення, перш ніж повідомити про тайм-аут.",
    type: "number",
    default: 5 * 60 * 1000,
    min: 5000,
    max: 30 * 60 * 1000
  },
  {
    key: "proofRecheckIntervalMs",
    category: "identity",
    label: "Інтервал автоперевірки доказів (мс)",
    description: "Як часто у фоні (поки вкладка відкрита) автоматично перевіряються опубліковані докази ідентичності контактів.",
    type: "number",
    default: 24 * 60 * 60 * 1000,
    min: 60 * 1000,
    max: 7 * 24 * 60 * 60 * 1000
  },
  {
    key: "proofFailureThreshold",
    category: "identity",
    label: "Поріг послідовних невдач перевірки",
    description: "Скільки послідовних невдалих перевірок доказу поспіль, перш ніж показати його як \"не вдалося підтвердити\" в UI.",
    type: "number",
    default: 3,
    min: 1,
    max: 20
  },
  {
    key: "fileSizeWarningBytes",
    category: "fileTransfer",
    label: "Поріг попередження про розмір файлу (байти)",
    description: "Розмір файлу, починаючи з якого перед надсиланням показується попередження (файл усе одно надсилається, це не жорсткий ліміт).",
    type: "number",
    default: 100 * 1024 * 1024,
    min: 1024 * 1024,
    max: 2 * 1024 * 1024 * 1024
  },
  {
    key: "maxRecentAccounts",
    category: "accounts",
    label: "Кількість останніх акаунтів",
    description: "Скільки останніх акаунтів пам'ятається локально в цьому браузері для швидкого вибору на екрані входу.",
    type: "number",
    default: 10,
    min: 1,
    max: 50
  },
  {
    key: "floatingVideoDefaultWidth",
    category: "ui",
    label: "Ширина плаваючого відео за замовчуванням (px)",
    description: "Початкова ширина плаваючого вікна відеодзвінка -- лише поки ви жодного разу не змінювали розмір самостійно (після цього запам'ятовується ваш власний розмір).",
    type: "number",
    default: 320,
    min: 160,
    max: 1200
  },
  {
    key: "floatingVideoDefaultHeight",
    category: "ui",
    label: "Висота плаваючого відео за замовчуванням (px)",
    description: "Початкова висота плаваючого вікна відеодзвінка -- лише поки ви жодного разу не змінювали розмір самостійно.",
    type: "number",
    default: 240,
    min: 120,
    max: 1000
  },
  {
    key: "pushTtlSeconds",
    category: "notifications",
    label: "Час життя push-сповіщення (сек)",
    description: "Як довго push-сервіс намагається доставити сповіщення офлайн-отримувачу, перш ніж відмовитись від спроби.",
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
