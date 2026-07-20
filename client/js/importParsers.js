// Section I1 (specs/phase2b/import.md): pure parser functions for optional
// contact/history import. No UI/DOM/IndexedDB dependency -- see
// docs/migration.md for the architectural rationale (manual matching only,
// zero-database, never auto-matched to a real Spirit identity).
//
// Format assumptions (documented per spec instructions, confidence noted):
//
// - Telegram contacts JSON export: `{ contacts: { list: [ { first_name,
//   last_name, phone_number, user_id, ... } ] } }`. This is Telegram
//   Desktop's documented "Export contacts" shape. MEDIUM-HIGH confidence on
//   the top-level `contacts.list` wrapper and `first_name`/`last_name`/
//   `phone_number` field names (well-documented, widely referenced format);
//   NOT verified against a live export in this environment.
// - Telegram chat history JSON export: `{ name, messages: [ { id, type,
//   date, from, text } ] }`, where `type` is "message" for real messages
//   and something else (e.g. "service") for join/leave/pin notices, and
//   `text` is either a plain string or an array of text-entity objects
//   (`{ type, text, ... }`) when the message has rich formatting/links.
//   Same confidence level as above. Non-"message" entries are deliberately
//   skipped -- service messages don't map onto the { timestamp, sender,
//   text } chat-message shape this function returns.
// - vCard (.vcf): standard vCard 3.0/4.0 text, one or more concatenated
//   `BEGIN:VCARD ... END:VCARD` blocks. Line-folding (continuation lines
//   starting with a space, per RFC 6350) is NOT implemented in this first
//   cut -- each vCard field is assumed to fit on one line. This is a known,
//   deliberate limitation, not an oversight.
// - WhatsApp contacts export: WhatsApp has no single standard
//   machine-readable contacts export. ASSUMPTION (low-to-medium
//   confidence, not verified against a real export): since WhatsApp's
//   "export contacts" flow typically goes through the OS contacts
//   mechanism, a vCard-compatible file is a reasonable stand-in, so
//   `parseContactList(text, "whatsapp")` simply reuses the vCard parser.
//   This is a documented judgment call, not a verified fact about
//   WhatsApp's format.
// - WhatsApp chat .txt export: lines of the form
//   `DD/MM/YYYY, HH:MM - Sender Name: message text`, where a message may
//   span multiple lines; continuation lines (that don't match the
//   date/time/sender prefix) belong to the previous message. Only the
//   24-hour `HH:MM` time format is supported in this first cut (WhatsApp's
//   locale-dependent 12-hour `HH:MM am/pm` variant is a known limitation,
//   not implemented, to avoid a half-supported, buggy multi-format parser).

function fail(message) {
  throw new Error(`importParsers: ${message}`);
}

function parseJson(fileText, context) {
  try {
    return JSON.parse(fileText);
  } catch (e) {
    fail(`invalid JSON in ${context}: ${e.message}`);
  }
}

// --- Telegram contacts JSON -------------------------------------------------

function parseTelegramContactsJson(fileText) {
  const data = parseJson(fileText, "Telegram contacts export");
  if (!data || typeof data !== "object" || !data.contacts || !Array.isArray(data.contacts.list)) {
    fail(
      "Telegram contacts export is missing the expected { contacts: { list: [...] } } shape"
    );
  }
  return data.contacts.list.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      fail(`Telegram contact at index ${index} is not an object`);
    }
    const first = typeof entry.first_name === "string" ? entry.first_name : "";
    const last = typeof entry.last_name === "string" ? entry.last_name : "";
    const displayName = [first, last].filter((part) => part.length > 0).join(" ");
    if (displayName.length === 0) {
      fail(`Telegram contact at index ${index} has no first_name or last_name`);
    }
    let sourceIdentifier;
    if (typeof entry.phone_number === "string" && entry.phone_number.length > 0) {
      sourceIdentifier = entry.phone_number;
    } else if (entry.user_id !== undefined && entry.user_id !== null) {
      sourceIdentifier = String(entry.user_id);
    } else {
      fail(`Telegram contact at index ${index} has no phone_number or user_id to use as identifier`);
    }
    return { displayName, sourceIdentifier };
  });
}

// --- vCard -------------------------------------------------------------------

function splitVcardBlocks(fileText) {
  const trimmed = fileText.trim();
  if (trimmed.length === 0) return [];

  const lines = trimmed.split(/\r\n|\r|\n/);
  const blocks = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (/^BEGIN:VCARD$/i.test(line)) {
      if (current !== null) {
        fail("nested BEGIN:VCARD without matching END:VCARD");
      }
      current = [];
    } else if (/^END:VCARD$/i.test(line)) {
      if (current === null) {
        fail("END:VCARD without matching BEGIN:VCARD");
      }
      blocks.push(current);
      current = null;
    } else if (current !== null) {
      current.push(line);
    }
    // Lines outside any BEGIN/END block are ignored.
  }
  if (current !== null) {
    fail("BEGIN:VCARD without matching END:VCARD");
  }
  return blocks;
}

function parseVcardField(line) {
  // vCard lines are "NAME[;PARAM=...]:VALUE" -- split on the first
  // unparameterized colon.
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return null;
  const namePart = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);
  const name = namePart.split(";")[0].toUpperCase();
  return { name, value };
}

function parseVcardText(fileText) {
  const blocks = splitVcardBlocks(fileText);
  return blocks.map((lines, index) => {
    let fn = null;
    let tel = null;
    let email = null;
    for (const line of lines) {
      const field = parseVcardField(line);
      if (!field) continue;
      if (field.name === "FN" && fn === null) fn = field.value;
      else if (field.name === "TEL" && tel === null) tel = field.value;
      else if (field.name === "EMAIL" && email === null) email = field.value;
    }
    if (!fn) {
      fail(`vCard at index ${index} has no FN (display name) field`);
    }
    const sourceIdentifier = tel || email;
    if (!sourceIdentifier) {
      fail(`vCard at index ${index} has no TEL or EMAIL field to use as identifier`);
    }
    return { displayName: fn, sourceIdentifier };
  });
}

// --- Telegram chat history JSON ----------------------------------------------

function extractTelegramText(text) {
  if (typeof text === "string") return text;
  if (Array.isArray(text)) {
    return text
      .map((entity) => {
        if (typeof entity === "string") return entity;
        if (entity && typeof entity.text === "string") return entity.text;
        return "";
      })
      .join("");
  }
  return "";
}

function parseTelegramChatJson(fileText) {
  const data = parseJson(fileText, "Telegram chat export");
  if (!data || typeof data !== "object" || !Array.isArray(data.messages)) {
    fail("Telegram chat export is missing the expected { messages: [...] } shape");
  }
  const result = [];
  data.messages.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      fail(`Telegram chat entry at index ${index} is not an object`);
    }
    if (entry.type !== "message") return; // skip service messages etc.
    if (typeof entry.date !== "string") {
      fail(`Telegram chat message at index ${index} has no date`);
    }
    const timestamp = Date.parse(entry.date);
    if (Number.isNaN(timestamp)) {
      fail(`Telegram chat message at index ${index} has an unparseable date: ${entry.date}`);
    }
    if (typeof entry.from !== "string") {
      fail(`Telegram chat message at index ${index} has no from/sender`);
    }
    const text = extractTelegramText(entry.text);
    result.push({ timestamp, sender: entry.from, text });
  });
  return result;
}

// --- WhatsApp chat .txt -------------------------------------------------------

// Matches "DD/MM/YYYY, HH:MM - Sender: " at the start of a line. Bounded
// quantifiers on every group (no unbounded repetition of ambiguous
// character classes) avoid catastrophic backtracking regardless of input
// length.
const WHATSAPP_LINE_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{1,2}):(\d{2}) - ([^:\n]{1,200}?): ([\s\S]*)$/;

function parseWhatsappTxt(fileText) {
  const trimmed = fileText.trim();
  if (trimmed.length === 0) return [];

  const lines = trimmed.split(/\r\n|\r|\n/);
  const result = [];
  let current = null;

  for (const line of lines) {
    const match = WHATSAPP_LINE_RE.exec(line);
    if (match) {
      if (current) result.push(current);
      const [, day, month, year, hour, minute, sender, text] = match;
      const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(
        2,
        "0"
      )}:${minute}:00`;
      const timestamp = Date.parse(iso);
      if (Number.isNaN(timestamp)) {
        fail(`WhatsApp chat line has an unparseable date/time: "${line}"`);
      }
      current = { timestamp, sender, text };
    } else if (current) {
      current.text += `\n${line}`;
    } else {
      fail(
        `WhatsApp chat export: first line does not match the expected "DD/MM/YYYY, HH:MM - Sender: text" format: "${line}"`
      );
    }
  }
  if (current) result.push(current);
  return result;
}

// --- Public API ----------------------------------------------------------

export function parseContactList(fileText, format) {
  if (typeof fileText !== "string") fail("fileText must be a string");
  switch (format) {
    case "telegram-json":
      return parseTelegramContactsJson(fileText);
    case "vcard":
      return parseVcardText(fileText);
    case "whatsapp":
      // See module-level comment: WhatsApp contacts export is assumed to
      // be vCard-compatible, so we reuse the vCard parser as-is.
      return parseVcardText(fileText);
    default:
      fail(`unknown contact list format: ${format}`);
  }
}

export function parseChatExport(fileText, format) {
  if (typeof fileText !== "string") fail("fileText must be a string");
  switch (format) {
    case "telegram-json":
      return parseTelegramChatJson(fileText);
    case "whatsapp-txt":
      return parseWhatsappTxt(fileText);
    default:
      fail(`unknown chat export format: ${format}`);
  }
}
