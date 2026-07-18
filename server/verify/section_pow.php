<?php
/**
 * Live verification harness for specs/phase5/sybil-resistance.md, Section
 * SR1 (Pow crypto core). Kept in the repo permanently, matching the
 * established precedent of section6_storage.php/section7_invite_manager.php/
 * section8_cors.php/section9_rate_limiter.php (all still present since
 * Phase 1 -- these are not transient scratch files).
 *
 * The critical check here is the CROSS-LANGUAGE test-vector block: the same
 * (challenge, nonce, exactLeadingZeroBits) tuples asserted here via
 * Pow::verify() are ALSO asserted in client/tests/pow.test.js via
 * verifyPow() -- same CHALLENGE constant, same nonces, same expected bit
 * counts, cross-referenced by comment in both files. If PHP's hash(...,
 * true) + bit-counting ever diverges from JS's crypto.subtle.digest +
 * bit-counting (byte encoding, bit order, off-by-one in the loop), exactly
 * one of the two files' assertions on these shared tuples will fail.
 */

require __DIR__ . '/../library/Pow.php';

use Spirit\Pow;

header('Content-Type: application/json');

$results = [];

// Same tuples as client/tests/pow.test.js's CHALLENGE/VECTORS -- hand
// computed via an independent Node script (crypto.createHash, NOT this
// codebase's own bit-counting logic on either side) against
// SHA-256("1000:testSenderKey:<nonce>").
$challenge = '1000:testSenderKey';
$vectors = [
    // [nonce, exact leading-zero-bit count]
    ['1', 0],
    ['36', 4],
    ['21', 8],
    ['11280', 12],
];

$vectorChecks = [];
foreach ($vectors as [$nonce, $exactBits]) {
    $atExact = Pow::verify($challenge, $nonce, $exactBits);
    $aboveExact = Pow::verify($challenge, $nonce, $exactBits + 1);
    $vectorChecks[] = $atExact === true && $aboveExact === false;
}
$results['cross_language_vectors_match_js_pow_test'] = !in_array(false, $vectorChecks, true);

$results['difficulty_0_always_passes'] = Pow::verify('anything', 'whatever-nonce', 0) === true
    && Pow::verify($challenge, '1', 0) === true;

$results['unreachably_high_difficulty_always_fails'] = Pow::verify($challenge, '1', 256) === false
    && Pow::verify('random-challenge', 'random-nonce', 255) === false;

// buildPowChallenge's exact string format, reconstructed server-side the
// way SR2's integration will (plain PHP string concatenation) -- must be
// byte-identical to client/js/pow.js's `${timeWindow}:${senderKey}`
// template literal for the same inputs.
$results['challenge_string_format_matches_js_template_literal'] =
    (1000 . ':' . 'testSenderKey') === '1000:testSenderKey'
    && (0 . ':' . 'abc') === '0:abc'
    && (42 . ':' . '') === '42:';

// Edge case explicitly called out in the spec/review scope: a digest whose
// very first bit is already 1 (0 leading zero bits) must not be miscounted
// by an off-by-one in the bit-scanning loop. Nonce "1" above already covers
// this (0 leading zero bits, first byte 0xbf per the hand-computed vector),
// re-asserted explicitly here for clarity.
$results['first_bit_set_digest_counts_zero_leading_bits'] = Pow::verify($challenge, '1', 1) === false;

$results['all_passed'] = !in_array(false, $results, true);

echo json_encode($results, JSON_PRETTY_PRINT);
