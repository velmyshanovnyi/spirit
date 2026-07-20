// Section I1 (specs/phase2b/import.md): pure parser functions for optional
// contact/history import. No UI/DOM/IndexedDB -- see docs/migration.md for
// the "manual matching only, never auto-match by name/phone" rationale.
//
// All sample data below is hand-constructed fake data (fake Ukrainian
// names, fake phone numbers in an obviously-nonexistent range) -- never
// real exported data from a real person.
import { describe, it, expect } from "vitest";
import { parseContactList, parseChatExport } from "../js/importParsers.js";

describe("parseContactList", () => {
  describe("telegram-json format", () => {
    const sample = JSON.stringify({
      about: "Contacts from Telegram",
      contacts: {
        list: [
          {
            first_name: "Іван",
            last_name: "Петренко",
            phone_number: "+380501234567",
            date: "2026-01-01T12:00:00",
          },
          {
            first_name: "Emoji😀Name",
            last_name: "",
            phone_number: "+380509999999",
            date: "2026-01-01T12:00:00",
          },
        ],
      },
    });

    it("parses a realistic sample", () => {
      const result = parseContactList(sample, "telegram-json");
      expect(result).toEqual([
        { displayName: "Іван Петренко", sourceIdentifier: "+380501234567" },
        { displayName: "Emoji😀Name", sourceIdentifier: "+380509999999" },
      ]);
    });

    it("returns [] for an empty-but-valid contact list", () => {
      const empty = JSON.stringify({ about: "", contacts: { list: [] } });
      expect(parseContactList(empty, "telegram-json")).toEqual([]);
    });

    it("throws a clear Error on malformed JSON", () => {
      expect(() => parseContactList("{not valid json", "telegram-json")).toThrow(Error);
    });

    it("throws a clear Error when the expected shape is missing", () => {
      expect(() => parseContactList(JSON.stringify({ foo: "bar" }), "telegram-json")).toThrow(
        Error
      );
    });

    it("falls back to a non-phone identifier when phone_number is absent", () => {
      const noPhone = JSON.stringify({
        contacts: {
          list: [{ first_name: "Оксана", last_name: "Коваль", user_id: 123456 }],
        },
      });
      const result = parseContactList(noPhone, "telegram-json");
      expect(result).toEqual([{ displayName: "Оксана Коваль", sourceIdentifier: "123456" }]);
    });

    it("throws a clear Error when neither phone_number nor user_id is present", () => {
      const noIdentifier = JSON.stringify({
        contacts: { list: [{ first_name: "Без", last_name: "Ідентифікатора" }] },
      });
      expect(() => parseContactList(noIdentifier, "telegram-json")).toThrow(Error);
    });
  });

  describe("vcard format", () => {
    const sample = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Іван Петренко",
      "TEL:+380501234567",
      "EMAIL:ivan@example.test",
      "END:VCARD",
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Марія 😀 Шевченко",
      "TEL:+380509999999",
      "END:VCARD",
    ].join("\r\n");

    it("parses multiple concatenated vCards", () => {
      const result = parseContactList(sample, "vcard");
      expect(result).toEqual([
        { displayName: "Іван Петренко", sourceIdentifier: "+380501234567" },
        { displayName: "Марія 😀 Шевченко", sourceIdentifier: "+380509999999" },
      ]);
    });

    it("falls back to EMAIL when TEL is absent", () => {
      const noTel = ["BEGIN:VCARD", "FN:Тест Тестенко", "EMAIL:test@example.test", "END:VCARD"].join(
        "\r\n"
      );
      expect(parseContactList(noTel, "vcard")).toEqual([
        { displayName: "Тест Тестенко", sourceIdentifier: "test@example.test" },
      ]);
    });

    it("returns [] for an empty file", () => {
      expect(parseContactList("", "vcard")).toEqual([]);
      expect(parseContactList("   \n  ", "vcard")).toEqual([]);
    });

    it("throws a clear Error when BEGIN:VCARD has no matching END:VCARD", () => {
      expect(() => parseContactList("BEGIN:VCARD\nFN:Broken\n", "vcard")).toThrow(Error);
    });

    it("throws a clear Error when a vCard has no FN field", () => {
      expect(() =>
        parseContactList("BEGIN:VCARD\nTEL:+380501234567\nEND:VCARD", "vcard")
      ).toThrow(Error);
    });

    it("throws a clear Error when a vCard has FN but no TEL or EMAIL", () => {
      expect(() => parseContactList("BEGIN:VCARD\nFN:Без Номера\nEND:VCARD", "vcard")).toThrow(
        Error
      );
    });
  });

  describe("whatsapp format (reuses vCard parsing -- see code comment)", () => {
    it("parses a vCard-shaped WhatsApp contacts export", () => {
      const sample = ["BEGIN:VCARD", "FN:Петро Іваненко", "TEL:+380671112233", "END:VCARD"].join(
        "\n"
      );
      expect(parseContactList(sample, "whatsapp")).toEqual([
        { displayName: "Петро Іваненко", sourceIdentifier: "+380671112233" },
      ]);
    });

    it("returns [] for an empty file", () => {
      expect(parseContactList("", "whatsapp")).toEqual([]);
    });
  });

  it("throws a clear Error for an unknown format", () => {
    expect(() => parseContactList("whatever", "unknown-format")).toThrow(Error);
  });
});

describe("parseChatExport", () => {
  describe("telegram-json format", () => {
    it("parses plain-string and text-entity-array messages, skipping service messages", () => {
      const sample = JSON.stringify({
        name: "Fake Chat",
        messages: [
          {
            id: 1,
            type: "message",
            date: "2026-01-01T12:00:00",
            from: "Іван Петренко",
            text: "Привіт! 😀",
          },
          {
            id: 2,
            type: "service",
            date: "2026-01-01T12:01:00",
            action: "invite_members",
          },
          {
            id: 3,
            type: "message",
            date: "2026-01-01T12:02:00",
            from: "Марія",
            text: [
              { type: "plain", text: "Дивись " },
              { type: "link", text: "https://example.test" },
              { type: "plain", text: " ось лінк" },
            ],
          },
        ],
      });

      const result = parseChatExport(sample, "telegram-json");
      expect(result).toEqual([
        {
          timestamp: Date.parse("2026-01-01T12:00:00"),
          sender: "Іван Петренко",
          text: "Привіт! 😀",
        },
        {
          timestamp: Date.parse("2026-01-01T12:02:00"),
          sender: "Марія",
          text: "Дивись https://example.test ось лінк",
        },
      ]);
    });

    it("returns [] for an empty-but-valid message list", () => {
      const empty = JSON.stringify({ name: "Empty", messages: [] });
      expect(parseChatExport(empty, "telegram-json")).toEqual([]);
    });

    it("throws a clear Error on malformed JSON", () => {
      expect(() => parseChatExport("{broken", "telegram-json")).toThrow(Error);
    });

    it("throws a clear Error when the expected shape is missing", () => {
      expect(() => parseChatExport(JSON.stringify({ foo: "bar" }), "telegram-json")).toThrow(
        Error
      );
    });
  });

  describe("whatsapp-txt format", () => {
    it("parses single-line messages", () => {
      const sample = [
        "01/02/2026, 09:15 - Іван Петренко: Привіт!",
        "01/02/2026, 09:16 - Марія: Як справи? 😀",
      ].join("\n");
      expect(parseChatExport(sample, "whatsapp-txt")).toEqual([
        { timestamp: Date.parse("2026-02-01T09:15:00"), sender: "Іван Петренко", text: "Привіт!" },
        {
          timestamp: Date.parse("2026-02-01T09:16:00"),
          sender: "Марія",
          text: "Як справи? 😀",
        },
      ]);
    });

    it("joins a multi-line message into ONE entry, not several", () => {
      const sample = [
        "01/02/2026, 09:15 - Іван Петренко: Перший рядок",
        "другий рядок того ж повідомлення",
        "і третій рядок теж",
        "01/02/2026, 09:16 - Марія: Окреме повідомлення",
      ].join("\n");
      const result = parseChatExport(sample, "whatsapp-txt");
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        timestamp: Date.parse("2026-02-01T09:15:00"),
        sender: "Іван Петренко",
        text: "Перший рядок\nдругий рядок того ж повідомлення\nі третій рядок теж",
      });
      expect(result[1]).toEqual({
        timestamp: Date.parse("2026-02-01T09:16:00"),
        sender: "Марія",
        text: "Окреме повідомлення",
      });
    });

    it("keeps two consecutive multi-line messages from different senders separate", () => {
      const sample = [
        "01/02/2026, 09:15 - Іван: рядок 1",
        "рядок 2 від Івана",
        "01/02/2026, 09:20 - Марія: рядок 1",
        "рядок 2 від Марії",
        "рядок 3 від Марії",
      ].join("\n");
      const result = parseChatExport(sample, "whatsapp-txt");
      expect(result).toEqual([
        { timestamp: Date.parse("2026-02-01T09:15:00"), sender: "Іван", text: "рядок 1\nрядок 2 від Івана" },
        {
          timestamp: Date.parse("2026-02-01T09:20:00"),
          sender: "Марія",
          text: "рядок 1\nрядок 2 від Марії\nрядок 3 від Марії",
        },
      ]);
    });

    it("returns [] for an empty file", () => {
      expect(parseChatExport("", "whatsapp-txt")).toEqual([]);
      expect(parseChatExport("   \n  ", "whatsapp-txt")).toEqual([]);
    });

    it("throws a clear Error when the very first line doesn't match the expected prefix", () => {
      expect(() => parseChatExport("this is not a whatsapp export at all", "whatsapp-txt")).toThrow(
        Error
      );
    });
  });

  it("throws a clear Error for an unknown format", () => {
    expect(() => parseChatExport("whatever", "unknown-format")).toThrow(Error);
  });
});
