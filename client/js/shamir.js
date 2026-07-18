// Section S1 (specs/phase5/social-recovery.md): Shamir's Secret Sharing over
// GF(2^8), the same finite field as AES's S-box / QR-code Reed-Solomon codes
// (irreducible polynomial x^8+x^4+x^3+x+1 = 0x11B). Self-contained crypto
// core with ZERO dependency on the rest of the app -- mirrors the pattern
// used for ratchet.js (Section P2a) and webPushCrypto.js (Section PN1).
// Distribution to trusted contacts and the recovery UI are separate,
// not-yet-started sections (S2, S3).
//
// No-bundler invariant: GF(256) arithmetic is implemented directly here via
// precomputed log/antilog tables (simpler to get right and to test in
// isolation than inline peasant-multiplication-with-reduction), no external
// library or vendored dependency needed.

// --- GF(256) arithmetic -----------------------------------------------

const GF_EXP = new Uint8Array(512); // antilog table, doubled to avoid modulo in gfMul
const GF_LOG = new Uint8Array(256); // log table

// Build the tables using generator 0x03 (a primitive element of this field
// -- 0x02 is NOT primitive under 0x11B, its multiplicative order is only 51,
// so it would silently produce a broken, self-consistent-looking table; 3 is
// the standard AES/Reed-Solomon choice and does generate the full 255-
// element cyclic group), reducing by the AES irreducible polynomial 0x11B
// whenever the 8th bit overflows.
(function buildGfTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    // Multiply by generator 3 = 2*x XOR x (xtime(x) XOR x).
    let doubled = x << 1;
    if (doubled & 0x100) doubled ^= 0x11b;
    x = doubled ^ x;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

/** GF(256) addition/subtraction -- both are XOR in a characteristic-2 field. */
export function gfAdd(a, b) {
  return a ^ b;
}

/** GF(256) multiplication via log/antilog tables. */
export function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** GF(256) multiplicative inverse. 0 has no inverse -- throws. */
export function gfInverse(a) {
  if (a === 0) throw new Error("shamir: 0 has no multiplicative inverse in GF(256)");
  return GF_EXP[255 - GF_LOG[a]];
}

/** GF(256) division: a / b = a * inverse(b). */
export function gfDiv(a, b) {
  if (a === 0) return 0;
  return gfMul(a, gfInverse(b));
}

// --- Shamir secret sharing ----------------------------------------------

// x-coordinates are the first `shares` nonzero bytes (1, 2, 3, ...) -- any
// distinct set of nonzero bytes works for Lagrange interpolation, this is
// just the simplest deterministic choice that trivially guarantees
// uniqueness. x=0 is reserved for the secret itself (the polynomial's
// constant term) and is NEVER used as a share's evaluation point.
const MAX_SHARES = 255; // only 255 nonzero elements exist in GF(256)

function randomNonzeroCoefficients(count) {
  const coeffs = crypto.getRandomValues(new Uint8Array(count));
  // A zero high-order coefficient just silently lowers the polynomial's
  // effective degree -- harmless for secrecy (still a valid degree-<=(t-1)
  // polynomial with the same secrecy guarantee), so no rejection needed.
  return coeffs;
}

/**
 * Evaluate a polynomial (given as [c0, c1, ..., cN], low-degree-first) at x
 * using Horner's method in GF(256).
 */
function evalPolynomial(coefficients, x) {
  let result = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) {
    result = gfAdd(gfMul(result, x), coefficients[i]);
  }
  return result;
}

/**
 * Split `secretBytes` into `shares` Shamir shares, any `threshold` of which
 * reconstruct the original secret exactly; any fewer reveal nothing
 * (information-theoretically, per Shamir's construction).
 *
 * Each byte of the secret gets its own independent random degree-
 * (threshold-1) polynomial over GF(256), with the secret byte as the
 * constant term (value at x=0). All shares reuse the same set of `shares`
 * distinct nonzero x-coordinates across every byte position.
 *
 * Returns an array of `{ x, y }` share objects, where `y` is a Uint8Array
 * the same length as `secretBytes`. Self-describing: `combineShares` needs
 * no out-of-band knowledge of `threshold` or secret length.
 */
export function splitSecret(secretBytes, { threshold, shares }) {
  if (!(secretBytes instanceof Uint8Array) && !Array.isArray(secretBytes)) {
    throw new Error("shamir: secretBytes must be a Uint8Array or byte array");
  }
  if (secretBytes.length === 0) {
    throw new Error("shamir: cannot split an empty secret");
  }
  if (!Number.isInteger(threshold) || threshold < 2) {
    throw new Error("shamir: threshold must be an integer >= 2");
  }
  if (!Number.isInteger(shares) || shares < 1) {
    throw new Error("shamir: shares must be a positive integer");
  }
  if (threshold > shares) {
    throw new Error("shamir: threshold cannot exceed the number of shares");
  }
  if (shares > MAX_SHARES) {
    throw new Error(`shamir: shares cannot exceed ${MAX_SHARES} (GF(256) has only 255 nonzero elements)`);
  }

  const secret = Uint8Array.from(secretBytes);
  const xs = Array.from({ length: shares }, (_, i) => i + 1); // 1..shares, never 0

  const shareYs = xs.map(() => new Uint8Array(secret.length));

  for (let byteIndex = 0; byteIndex < secret.length; byteIndex++) {
    // Degree-(threshold-1) polynomial: constant term is the secret byte,
    // the remaining (threshold-1) coefficients are fresh random bytes from
    // the Web Crypto CSPRNG, one polynomial per secret byte.
    const randomCoeffs = randomNonzeroCoefficients(threshold - 1);
    const coefficients = [secret[byteIndex], ...randomCoeffs];

    for (let shareIndex = 0; shareIndex < xs.length; shareIndex++) {
      shareYs[shareIndex][byteIndex] = evalPolynomial(coefficients, xs[shareIndex]);
    }
  }

  return xs.map((x, i) => ({ x, y: shareYs[i] }));
}

/**
 * Reconstruct the original secret from >= `threshold` shares via Lagrange
 * interpolation in GF(256), evaluating each byte's polynomial at x=0.
 *
 * Given fewer than the true threshold, this still returns bytes of the
 * right length -- but they are uniformly random garbage, not the original
 * secret and not a detectable error, matching Shamir's guarantee that
 * sub-threshold shares leak no information.
 */
export function combineShares(shareSubset) {
  if (!Array.isArray(shareSubset) || shareSubset.length === 0) {
    throw new Error("shamir: combineShares requires at least one share");
  }

  const secretLength = shareSubset[0].y.length;
  for (const share of shareSubset) {
    if (share.y.length !== secretLength) {
      throw new Error("shamir: all shares must have the same secret length");
    }
  }

  const xs = shareSubset.map((s) => s.x);
  if (new Set(xs).size !== xs.length) {
    throw new Error("shamir: duplicate x-coordinate among supplied shares");
  }

  const recovered = new Uint8Array(secretLength);

  for (let byteIndex = 0; byteIndex < secretLength; byteIndex++) {
    // Lagrange interpolation at x=0: secret = sum_i( y_i * L_i(0) ), where
    // L_i(0) = product_{j != i}( x_j / (x_j - x_i) ) = product_{j != i}( x_j / (x_j XOR x_i) )
    // since subtraction is XOR in GF(256).
    let value = 0;
    for (let i = 0; i < shareSubset.length; i++) {
      const xi = shareSubset[i].x;
      const yi = shareSubset[i].y[byteIndex];

      let basis = 1;
      for (let j = 0; j < shareSubset.length; j++) {
        if (j === i) continue;
        const xj = shareSubset[j].x;
        basis = gfMul(basis, gfDiv(xj, gfAdd(xj, xi)));
      }

      value = gfAdd(value, gfMul(yi, basis));
    }

    recovered[byteIndex] = value;
  }

  return recovered;
}
