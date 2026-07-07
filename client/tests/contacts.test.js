import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { rememberContact, getContact, updateContactDeviceList } from "../js/contacts.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

const FP = "c".repeat(64);

describe("rememberContact / getContact", () => {
  it("stores a first-seen contact and reports it as new (TOFU)", async () => {
    const { status, contact } = await rememberContact({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", now: 1234 });

    expect(status).toBe("new");
    expect(contact).toEqual({ fingerprint: FP, identityPubkeyWire: "PUB_WIRE", firstSeen: 1234, deviceList: null });
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
      deviceList
    });
  });

  it("throws for an unknown contact instead of creating an orphan record", async () => {
    await expect(updateContactDeviceList("f".repeat(64), { version: 1 })).rejects.toThrow(/unknown contact/i);
  });
});
