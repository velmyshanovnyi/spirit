<?php

namespace Spirit;

/**
 * Manages invite-token based access to signaling rooms (see
 * docs/signaling-protocol.md). Replaces the earlier draft's hardcoded
 * public-key whitelist with a dynamic, one-time invite token per room,
 * plus an optional static whitelist for private nodes.
 */
class InviteManager
{
    private Storage $storage;

    public function __construct(Storage $storage)
    {
        $this->storage = $storage;
    }

    /**
     * Creates a new room with a fresh invite token. The caller (controller)
     * is responsible for later populating 'offer' via create_offer.
     *
     * @return array{roomId: string, inviteToken: string}
     */
    public function createInvite(string $senderKey): array
    {
        $db = $this->storage->load();

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

        $this->storage->save($db);

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
     * Marks the invite token for $roomId as consumed so it cannot be reused,
     * independent of TTL. Per docs/signaling-protocol.md, this happens
     * immediately after a successful submit_answer.
     */
    public function markInviteUsed(array &$db, string $roomId): void
    {
        if (isset($db['sessions'][$roomId])) {
            $db['sessions'][$roomId]['invite_used'] = true;
            $this->storage->save($db);
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
