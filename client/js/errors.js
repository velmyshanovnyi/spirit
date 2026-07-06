/**
 * Shared domain errors for vault-backed modules (profile.js, keyfile.js).
 * Consolidated here (rather than each module defining its own) once
 * Section 6 made them converge in the same restore flow -- a UI layer
 * handling both profile-load and keyfile-restore failures needs only one
 * catch clause, not two near-identical classes with different names.
 */

export class IncorrectPassphraseError extends Error {
  constructor() {
    super("Incorrect passphrase or corrupted data");
    this.name = "IncorrectPassphraseError";
  }
}

export class NoStoredProfileError extends Error {
  constructor() {
    super("No permanent profile is stored on this device");
    this.name = "NoStoredProfileError";
  }
}
