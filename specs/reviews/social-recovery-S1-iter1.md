---
spec: phase5/social-recovery
section: S1
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/shamir.js
  - client/tests/shamir.test.js
  - specs/phase5/social-recovery.md
---

Zero findings requiring code changes. Crypto core reviewed against 5 scrutiny points:

1. **GF(256) correctness / generator regression detection** — table build (`shamir.js:26-34`) computes `x = xtime(x) XOR x = 3x`, confirmed correct multiply-by-3 (the standard AES/Reed-Solomon generator; 0x02 is NOT primitive under 0x11B, order 51 not 255 — an earlier implementation attempt used generator 2 and was caught by the exhaustive `gfInverse` test before this review). A regression back to generator 2 would leave ~204 `GF_LOG` entries at 0 and would be caught by the exhaustive inverse test (`gfMul(a, gfInverse(a)) === 1` for all 1..255) and the hand-verified reference-product test.
2. **CSPRNG usage** — `crypto.getRandomValues` used exclusively (no `Math.random` anywhere in the file); confirmed fresh coefficients generated per secret byte inside the per-byte loop, i.e. independent polynomials, not reused.
3. **x-coordinate distinctness / x=0 reservation** — `xs = 1..shares` deterministically distinct (not probabilistic); `shares > 255` rejected; x=0 never assigned to a share, used only as the interpolation target.
4. **Sub-threshold leak** — reconstructing with `threshold-1` shares fits a lower-degree curve through points on the true higher-degree polynomial; the recovered constant term is uniform over GF(256) and independent of the true secret (information-theoretic, not just empirically untested).
5. **Lagrange/inverse/validation** — interpolation formula (`gfDiv(xj, gfAdd(xj, xi))`) correctly derived from `(0-xj)/(xi-xj)` under char-2 subtraction=XOR; `gfInverse` range and zero-throw correct; all edge cases (threshold<2, threshold>shares, shares>255, empty secret, non-array input, combineShares duplicate-x/empty/mismatched-length) validated and tested.

Minor cosmetic nit (dismissed, non-blocking per reviewer's own characterization): `randomNonzeroCoefficients` name is slightly misleading since zero coefficients are in fact permitted (harmless — a zero leading coefficient just lowers the polynomial's effective degree without weakening the secrecy guarantee, per the function's own inline comment). Not a correctness or security issue; left as-is.

Convergence: reached on iteration 1, no re-review needed.
