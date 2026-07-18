// Section S3 (specs/phase5/social-recovery.md): pure orchestration for the
// owner-side recovery flow -- decode pasted share-text strings (S2's
// `spirit-share:...` format), validate they are mutually consistent (came
// from the SAME splitSecret() call), and combine them back into the
// identity scalar. Deliberately UI-independent and directly testable,
// mirroring how this codebase always separates pure logic from DOM-wiring
// glue (e.g. sw.js's parsePushData).
//
// Mixing shares from two different split cycles is the most important
// failure mode to catch HERE, before combineShares ever runs: Shamir's
// construction gives no error signal for combining inconsistent/insufficient
// shares -- it silently returns plausible-looking-but-wrong bytes (see
// shamir.js's combineShares doc comment). The only thing we CAN check
// mechanically is that every decoded share claims the same (threshold,
// totalShares) and that we have at least `threshold` of them; whether the
// scalar decodes into a valid P-256 key, and whether the resulting identity
// is actually the right one, are checked by the caller after combineShares.

import { decodeShareFromText } from "./recoveryShare.js";
import { combineShares } from "./shamir.js";

/**
 * @typedef {{ ok: true, scalar: Uint8Array }} RecoverySuccess
 * @typedef {{ ok: false, reason: "empty" | "malformed" | "inconsistent" | "insufficient", detail?: string }} RecoveryFailure
 */

/**
 * @param {string[]} shareTexts raw pasted lines, one `spirit-share:...` string each.
 * @returns {RecoverySuccess | RecoveryFailure}
 */
export function recoverFromShares(shareTexts) {
  const lines = (shareTexts || []).map((s) => (typeof s === "string" ? s.trim() : "")).filter((s) => s.length > 0);

  if (lines.length === 0) {
    return { ok: false, reason: "empty", detail: "no share text provided" };
  }

  const decoded = [];
  for (const line of lines) {
    const share = decodeShareFromText(line);
    if (!share) {
      return { ok: false, reason: "malformed", detail: line };
    }
    decoded.push(share);
  }

  // Consistency check BEFORE combineShares: every decoded share must claim
  // the same (threshold, totalShares) -- otherwise they came from different
  // split cycles and combining them silently produces garbage, not an error.
  const { threshold, totalShares } = decoded[0];
  for (const share of decoded) {
    if (share.threshold !== threshold || share.totalShares !== totalShares) {
      return { ok: false, reason: "inconsistent", detail: "shares report different threshold/totalShares" };
    }
  }

  // Duplicate x-coordinates (same share pasted twice) don't add information
  // -- de-dupe before the sufficiency check so a repeat can't be miscounted
  // as an extra distinct share.
  const byX = new Map();
  for (const share of decoded) {
    byX.set(share.x, share);
  }
  const distinct = Array.from(byX.values());

  if (distinct.length < threshold) {
    return {
      ok: false,
      reason: "insufficient",
      detail: `have ${distinct.length} distinct share(s), need ${threshold}`
    };
  }

  const scalar = combineShares(distinct.slice(0, threshold));
  return { ok: true, scalar };
}
