<?php

namespace Spirit;

/**
 * Section SR2 (specs/phase5/sybil-resistance.md): anti-replay bookkeeping
 * for the proof-of-work check on create_invite. Tracks spent
 * (timeWindow, sender_key, nonce) triples so a single solved PoW can't be
 * replayed from many different IPs within the same time window -- without
 * this, one solved PoW would defeat the whole point of the Sybil defense
 * (a botnet could compute ONE PoW and fan it out to thousands of IPs).
 *
 * Same architectural pattern as RateLimiter.php: a JSON file, atomic
 * tmp-file-then-rename writes with LOCK_EX, TTL-based GC on every write.
 * Same best-effort caveat as RateLimiter.php: on shared hosting with
 * multiple PHP workers and no shared memory, there is a narrow race window
 * between load() and save() where two concurrent requests could both
 * observe a nonce as unspent and both mark it spent -- accepted here,
 * exactly as it is in RateLimiter.php, not this class's job to close.
 */
class PowNonceStore
{
    private string $file;
    private int $ttlSeconds;

    public function __construct(string $file, int $ttlSeconds)
    {
        $this->file = $file;
        $this->ttlSeconds = $ttlSeconds;
    }

    /**
     * Returns true if this (timeWindow, senderKey, nonce) triple was NOT
     * already spent (and records it as spent now); returns false if it WAS
     * already spent (replay detected -- caller should reject the request).
     */
    public function checkAndMarkSpent(string $timeWindow, string $senderKey, string $nonce): bool
    {
        $now = time();
        $data = $this->load();
        $key = $this->spentKey($timeWindow, $senderKey, $nonce);

        $alreadySpent = isset($data['spent'][$key]);
        if (!$alreadySpent) {
            $data['spent'][$key] = $now;
        }

        $this->gcStaleEntries($data, $now);
        $this->save($data);

        return !$alreadySpent;
    }

    private function spentKey(string $timeWindow, string $senderKey, string $nonce): string
    {
        // A plain delimited string is sufficient here (not attacker-facing,
        // never parsed back apart) -- just needs to be collision-free across
        // the three components, so each component's length is unbounded and
        // separators can't ambiguously merge two different triples together
        // as long as the delimiter itself doesn't appear... to avoid relying
        // on that assumption entirely, hash the tuple instead.
        return hash('sha256', $timeWindow . "\0" . $senderKey . "\0" . $nonce);
    }

    /**
     * Prunes entries older than 2 * POW_WINDOW_SECONDS (the same tolerance
     * window SR2's timestamp-freshness check uses) -- mirrors
     * RateLimiter::gcStaleEntries()'s "prune on every write" pattern. A
     * nonce older than this can never pass the timestamp-freshness check
     * again anyway, so keeping it around longer serves no purpose.
     */
    private function gcStaleEntries(array &$data, int $now): void
    {
        foreach ($data['spent'] as $key => $spentAt) {
            if ($now - $spentAt >= $this->ttlSeconds) {
                unset($data['spent'][$key]);
            }
        }
    }

    /**
     * Unlike Storage::load() (which throws on corrupted content to avoid
     * silently wiping live P2P sessions), a corrupted/unreadable
     * pow_spent.json is treated as empty here -- same rationale as
     * RateLimiter::load(): losing anti-replay bookkeeping only temporarily
     * weakens the anti-replay guarantee until fresh entries accumulate
     * again, far lower stakes than losing session state, and failing closed
     * here would take the whole signaling node down over a non-essential
     * bookkeeping file.
     */
    private function load(): array
    {
        if (!file_exists($this->file)) {
            return ['spent' => []];
        }
        $content = @file_get_contents($this->file);
        if ($content === false || $content === '') {
            return ['spent' => []];
        }
        $data = json_decode($content, true);
        return is_array($data) && isset($data['spent']) && is_array($data['spent']) ? $data : ['spent' => []];
    }

    private function save(array $data): bool
    {
        $json = json_encode($data, JSON_PRETTY_PRINT);
        if ($json === false) {
            return false;
        }
        $tmpFile = $this->file . '.tmp.' . bin2hex(random_bytes(8));
        if (file_put_contents($tmpFile, $json, LOCK_EX) === false) {
            @unlink($tmpFile);
            return false;
        }
        if (!rename($tmpFile, $this->file)) {
            @unlink($tmpFile);
            return false;
        }
        return true;
    }
}
