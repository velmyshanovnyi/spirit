<?php

namespace Spirit;

/**
 * Section SR1 (specs/phase5/sybil-resistance.md): server-side half of the
 * stateless hashcash-like proof-of-work check for create_invite. Pure
 * verification only -- no anti-replay bookkeeping, no timestamp-window
 * tolerance check, no wiring into SignalingController (that's Section SR2).
 * Mirrors client/js/pow.js's verifyPow() exactly: both sides must agree
 * bit-for-bit on the leading-zero-bit count over the SAME SHA-256 digest
 * bytes for the SAME challenge+nonce inputs.
 */
class Pow
{
    /**
     * Verifies that SHA-256(challenge . ":" . nonce) has at least
     * $difficultyBits leading zero bits, computed over the raw binary
     * digest (hash(..., true)) exactly as client/js/pow.js's verifyPow()
     * computes it over crypto.subtle.digest's raw bytes -- same
     * concatenation, same digest algorithm, same bit-counting order.
     */
    public static function verify(string $challenge, string $nonce, int $difficultyBits): bool
    {
        $digest = hash('sha256', $challenge . ':' . $nonce, true);
        return self::countLeadingZeroBits($digest) >= $difficultyBits;
    }

    /**
     * Section SR2: builds the challenge string exactly as
     * client/js/pow.js's buildPowChallenge(timeWindow, senderKey) does --
     * "${timeWindow}:${senderKey}". PHP's string interpolation of an int
     * produces the same plain decimal digits as JS's template-literal
     * coercion of a number (no leading zeros, no locale-dependent
     * formatting on either side), so this concatenation is byte-identical
     * to the JS side for the same (timeWindow, senderKey) inputs -- the
     * exact invariant SR1's cross-language review scrutinized.
     */
    public static function buildChallenge(int $timeWindow, string $senderKey): string
    {
        return $timeWindow . ':' . $senderKey;
    }

    /**
     * Counts leading zero BITS (not bytes) in a raw binary string,
     * most-significant-bit-first within each byte -- the same bit order as
     * client/js/pow.js's countLeadingZeroBits() over crypto.subtle.digest's
     * ArrayBuffer output (standard big-endian SHA-256 digest bytes on both
     * sides, so no endianness divergence is possible here). Returns the
     * full bit-length (8 * strlen) if every bit is zero.
     */
    private static function countLeadingZeroBits(string $digest): int
    {
        $count = 0;
        $length = strlen($digest);
        for ($i = 0; $i < $length; $i++) {
            $byte = ord($digest[$i]);
            if ($byte === 0) {
                $count += 8;
                continue;
            }
            for ($bit = 7; $bit >= 0; $bit--) {
                if (($byte >> $bit) & 1) {
                    return $count;
                }
                $count++;
            }
        }
        return $count;
    }
}
