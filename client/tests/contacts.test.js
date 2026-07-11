import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { rememberContact, getContact, updateContactDeviceList, listContacts } from "../js/contacts.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

const FP = "c".repeat(64);

describe("rememberContact / getContact", () => {
  it("stores a first-seen contact and reports it as new (TOFU)", async () => {
    const { status, contact } = await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", now: 1234 });

    expect(status).toBe("new");
    expect(contact).toEqual({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", firstSeen: 1234, deviceList: null, nickname: null });
    expect(await getContact(FP)).toEqual(contact);
  });

  it("reports an already-known contact without overwriting its original record", async () => {
    await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", now: 1234 });

    const second = await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", now: 9999 });

    expect(second.status).toBe("known");
    // firstSeen must remain the ORIGINAL time -- re-meeting a contact is not a re-registration.
    expect((await getContact(FP)).firstSeen).toBe(1234);
  });

  it("returns undefined for an unknown contact", async () => {
    expect(await getContact("f".repeat(64))).toBeUndefined();
  });
});

describe("updateContactDeviceList", () => {
  it("stores the device list on the existing contact, preserving the rest of the record", async () => {
    await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", now: 1234 });
    const deviceList = { version: 3, certificates: [], signature: "SIG" };

    await updateContactDeviceList(FP, deviceList);

    expect(await getContact(FP)).toEqual({
      fingerprint: FP,
      identityPubkeyWire: "PUB_WIRE",
      firstSeen: 1234,
      deviceList,
      nickname: null
    });
  });

  it("throws for an unknown contact instead of creating an orphan record", async () => {
    await expect(updateContactDeviceList("f".repeat(64), { version: 1 })).rejects.toThrow(/unknown contact/i);
  });
});

describe("listContacts", () => {
  it("returns an empty array when no contact has been remembered", async () => {
    expect(await listContacts()).toEqual([]);
  });

  it("returns every remembered contact", async () => {
    const other = "d".repeat(64);
    await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE_1", now: 1000 });
    await rememberContact({ fingerprint: other, identityPubkeyWire: "PUB_WIRE_2", now: 2000 });

    const contacts = await listContacts();

    expect(contacts.map((c) => c.fingerprint).sort()).toEqual([FP, other].sort());
    expect(contacts.find((c) => c.fingerprint === FP)).toEqual({
      fingerprint: FP,
      identityPubkeyWire: "PUB_WIRE_1",
      firstSeen: 1000,
      deviceList: null,
      nickname: null
    });
  });
});

describe("rememberContact nickname (Section 16)", () => {
  it("stores the announced nickname on a new contact", async () => {
    const { contact } = await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", nickname: "Оксана", now: 1234 });
    expect(contact.nickname).toBe("Оксана");
    expect((await getContact(FP)).nickname).toBe("Оксана");
  });

  it("updates the stored nickname when a known contact re-announces with a new one", async () => {
    await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", nickname: "старе ім'я", now: 1234 });

    const { status, contact } = await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", nickname: "нове ім'я", now: 9999 });

    expect(status).toBe("known");
    expect(contact.nickname).toBe("нове ім'я");
    expect((await getContact(FP)).nickname).toBe("нове ім'я");
    // firstSeen is still untouched by the nickname update.
    expect((await getContact(FP)).firstSeen).toBe(1234);
  });
});
