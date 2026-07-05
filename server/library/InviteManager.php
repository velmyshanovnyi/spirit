<?php

namespace Spirit;

/**
 * Manages invite-token based access to signaling rooms (see
 * docs/signaling-protocol.md). Replaces the earlier draft's hardcoded
 * public-key whitelist with a dynamic, one-time invite token per room,
 * plus an optional static whitelist for private nodes.
 *
 * This class is a pure state-manipulator: it never loads or saves Storage
 * itself. The controller (SignalingController, Section 10) is responsible
 * for loading $db, calling these methods, and saving -- all under a single
 * exclusive lock spanning the whole check-then-use sequence. That lock is
 * what actually closes the TOCTOU race a caller could otherwise hit by
 * loading/saving independently around each call (see the Section 7 exec
 * review carry-forward recorded in specs/phase1/mvp.md).
 */
class InviteManager
{
    /**
     * Creates a new room with a fresh invite token in $db. Does not persist
     * -- the caller saves once, after the whole request's mutations are
     * applied, inside its own lock.
     *
     * @return array{roomId: string, inviteToken: string}
     */
    public function createInvite(array &$db, string $senderKey): array
    {
        $roomId = bin2hex(random_bytes(16));
        $inviteToken = bin2hex(random_bytes(16));

        $db['sessions'][$roomId] = [
            'initiator' => $senderKey,
            'invite_token' => $inviteToken,
            'invite_used' => false,
            'offer' => null,
            'offer_ecdh_pubkey' => null,
            'answer' => null,
            'answer_ecdh_pubkey' => null,
            'timestamp' => time(),
        ];

        return ['roomId' => $roomId, 'inviteToken' => $inviteToken];
    }

    /**
     * Validates that $providedToken grants access to $roomId's session
     * right now (correct token, not already consumed). Does not check TTL
     * expiry -- that's handled by Storage::gcSessions removing the room
     * entirely, after which this returns false because the room won't exist.
     */
    public function isTokenValid(array $db, string $roomId, string $providedToken): bool
    {
        $session = $db['sessions'][$roomId] ?? null;
        if ($session === null) {
            return false;
        }
        return hash_equals((string) $session['invite_token'], $providedToken) && $session['invite_used'] === false;
    }

    /**
     * Marks the invite token for $roomId as consumed in $db so it cannot be
     * reused, independent of TTL. Per docs/signaling-protocol.md, this
     * happens immediately after a successful submit_answer. Does not
     * persist -- see class docblock.
     */
    public function markInviteUsed(array &$db, string $roomId): void
    {
        if (isset($db['sessions'][$roomId])) {
            $db['sessions'][$roomId]['invite_used'] = true;
        }
    }

    /**
     * Optional static whitelist mode for private nodes (see
     * docs/signaling-protocol.md). When $globalAccess is true, everyone is
     * allowed and $whiteList is ignored.
     *
     * @param string[] $whiteList
     */
    public function isSenderAllowed(string $senderKey, bool $globalAccess, array $whiteList): bool
    {
        if ($globalAccess) {
            return true;
        }
        foreach ($whiteList as $allowedKey) {
            if (hash_equals((string) $allowedKey, $senderKey)) {
                return true;
            }
        }
        return false;
    }
}
