// Section S2 (specs/phase5/social-recovery.md): pure helpers for
// distributing a single Shamir share (client/js/shamir.js, Section S1) to a
// trusted contact -- both the P2P announce path (mirrors
// pushSubscription.js's push-subscription-announce exactly) and the manual
// text-export path (second channel: QR/voice/other messenger).
//
// No secret-scalar handling here: this module only ever touches ALREADY-
// SPLIT share fragments ({x, y, threshold, totalShares}), which are
// individually useless below the threshold (Shamir's information-theoretic
// guarantee, Section S1) -- there is nothing extra to protect at this layer.

import { bytesToBase64Url, base64UrlToBytes } from "./webPushCrypto.js";

const MAX_SHARES = 255; // GF(256) ceiling, same bound enforced in shamir.js

/**
 * Builds the recovery-share-announce control message for one share, in the
 * exact shape wireChannelCallbacks/app.js sends over the encrypted chat
 * channel (JSON.stringify'd, then encryptMessage'd -- same as every other
 * *-announce control message).
 */
export function buildRecoveryShareAnnounce(share) {
  return {
    type: "recovery-share-announce",
    x: share.x,
    y: bytesToBase64Url(share.y),
    threshold: share.threshold,
    totalShares: share.totalShares
  };
}

/**
 * Validates an incoming recovery-share-announce control message from a
 * peer. Same defensive-parsing style as pushSubscription.js's
 * parsePushSubscriptionAnnounce -- rejects anything that isn't a
 * self-consistent, well-typed share rather than trusting the wire.
 * Returns { x, y (Uint8Array), threshold, totalShares } or null.
 */
export function parseRecoveryShareAnnounce(control) {
  if (!control || typeof control !== "object") return null;
  const { x, y, threshold, totalShares } = control;

  if (!Number.isInteger(x) || x < 1 || x > MAX_SHARES) return null;
  if (typeof y !== "string" || !y) return null;
  if (!Number.isInteger(threshold) || threshold < 2) return null;
  if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > MAX_SHARES) return null;
  if (threshold > totalShares) return null;
  // x is a share's 1-based index among totalShares -- x > totalShares is
  // self-inconsistent (exec review iter1, nice-to-have): rejected here even
  // though a below-threshold/inconsistent share is already information-
  // theoretically useless, to reject obviously malformed announces early.
  if (x > totalShares) return null;

  let yBytes;
  try {
    yBytes = base64UrlToBytes(y);
  } catch {
    return null;
  }
  if (!yBytes || yBytes.length === 0) return null;

  return { x, y: yBytes, threshold, totalShares };
}

// --- Manual text export (second channel, no QR rendering here) ----------
//
// A compact, copyable string encoding of one share: "<x>.<threshold>.<total>.<y-base64url>".
// Deliberately NOT JSON (shorter to read aloud/retype) and NOT a QR code --
// QR rendering is explicitly deferred (see the spec: no QR library is
// vendored in this codebase yet, and Section S2 does not introduce one).

const TEXT_PREFIX = "spirit-share:";

export function encodeShareAsText(share) {
  return `${TEXT_PREFIX}${share.x}.${share.threshold}.${share.totalShares}.${bytesToBase64Url(share.y)}`;
}

export function decodeShareFromText(text) {
  if (typeof text !== "string" || !text.startsWith(TEXT_PREFIX)) return null;
  const body = text.slice(TEXT_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 4) return null;
  const [xStr, thresholdStr, totalStr, yStr] = parts;
  const x = Number(xStr);
  const threshold = Number(thresholdStr);
  const totalShares = Number(totalStr);
  if (!Number.isInteger(x) || x < 1 || x > MAX_SHARES) return null;
  if (!Number.isInteger(threshold) || threshold < 2) return null;
  if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > MAX_SHARES) return null;
  if (threshold > totalShares) return null;
  if (!yStr) return null;
  let y;
  try {
    y = base64UrlToBytes(yStr);
  } catch {
    return null;
  }
  if (!y || y.length === 0) return null;
  return { x, y, threshold, totalShares };
}
