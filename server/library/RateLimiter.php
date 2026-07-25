<?php

namespace Spirit;

/**
 * Best-effort per-IP sliding-window rate limiting for the file-based
 * signaling node (docs/signaling-protocol.md). Two independent buckets:
 * general request rate ("requests") and room-creation rate
 * ("room_creations", stricter/longer window). Explicitly best-effort on
 * shared hosting with multiple PHP workers and no shared memory -- see
 * the caveat in signaling-protocol.md.
 */
class RateLimiter
{
    private string $rateLimitFile;
    private int $requestWindowSeconds;
    private int $maxRequestsPerWindow;
    private int $roomCreationWindowSeconds;
    private int $maxRoomCreationsPerWindow;
    private int $maxTrackedIps;

    public function __construct(
        string $rateLimitFile,
        int $requestWindowSeconds = 60,
        int $maxRequestsPerWindow = 20,
        int $roomCreationWindowSeconds = 3600,
        int $maxRoomCreationsPerWindow = 10,
        int $maxTrackedIps = 10000
    ) {
        $this->rateLimitFile = $rateLimitFile;
        $this->requestWindowSeconds = $requestWindowSeconds;
        $this->maxRequestsPerWindow = $maxRequestsPerWindow;
        $this->roomCreationWindowSeconds = $roomCreationWindowSeconds;
        $this->maxRoomCreationsPerWindow = $maxRoomCreationsPerWindow;
        $this->maxTrackedIps = $maxTrackedIps;
    }

    /**
     * Records this request and returns whether it's within the general
     * per-IP window. Records regardless of outcome so retry-storming past
     * the limit doesn't reset or avoid the count.
     */
    public function checkAndRecordRequest(string $ip): bool
    {
        return $this->checkAndRecord($ip, 'requests', $this->requestWindowSeconds, $this->maxRequestsPerWindow);
    }

    /**
     * Stricter, longer-window limit specifically for room-creating actions
     * (create_invite/create_offer), per signaling-protocol.md.
     */
    public function checkAndRecordRoomCreation(string $ip): bool
    {
        return $this->checkAndRecord(
            $ip,
            'room_creations',
            $this->roomCreationWindowSeconds,
            $this->maxRoomCreationsPerWindow
        );
    }

    // Section C4 (specs/reviews/spirit-evaluation-triage.md): checkAndRecord
    // used to load(), decide $allowed, then save() as three unsynchronized
    // steps -- two concurrent requests from the same IP could both load the
    // same under-the-limit count before either saved, so both would pass
    // regardless of maxCount. Held for the whole load-decide-save sequence
    // below, so concurrent requests for the SAME ip+bucket are serialized
    // and the count they each observe is never stale.
    private function checkAndRecord(string $ip, string $bucket, int $windowSeconds, int $maxCount): bool
    {
        $handle = fopen($this->rateLimitFile, 'c+');
        if ($handle === false) {
            // Same fail-open rationale as load()/save() below: a
            // rate-limit-file problem shouldn't take the whole node down.
            return true;
        }
        try {
            if (!flock($handle, LOCK_EX)) {
                return true;
            }

            $now = time();
            $data = $this->loadFromHandle($handle);

            $timestamps = $this->filterWindow($data['ips'][$ip][$bucket] ?? [], $now, $windowSeconds);
            $allowed = count($timestamps) < $maxCount;
            $timestamps[] = $now;
            $data['ips'][$ip][$bucket] = $timestamps;

            $this->gcStaleEntries($data, $now);
            $this->saveToHandle($handle, $data);

            return $allowed;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private function filterWindow(array $timestamps, int $now, int $windowSeconds): array
    {
        return array_values(array_filter($timestamps, static fn ($t) => $now - $t < $windowSeconds));
    }

    private function gcStaleEntries(array &$data, int $now): void
    {
        foreach ($data['ips'] as $ip => $record) {
            $requests = $this->filterWindow($record['requests'] ?? [], $now, $this->requestWindowSeconds);
            $roomCreations = $this->filterWindow(
                $record['room_creations'] ?? [],
                $now,
                $this->roomCreationWindowSeconds
            );
            if (empty($requests) && empty($roomCreations)) {
                unset($data['ips'][$ip]);
            } else {
                $data['ips'][$ip] = ['requests' => $requests, 'room_creations' => $roomCreations];
            }
        }

        // Hard cap on distinct tracked IPs (independent of window TTL), evicting
        // whichever IPs have the oldest most-recent activity first -- protects
        // the file from unbounded growth under high-cardinality traffic (e.g. a
        // botnet/large NAT range) between natural window expirations.
        if (count($data['ips']) > $this->maxTrackedIps) {
            uasort($data['ips'], static function ($a, $b) {
                $lastA = max(array_merge($a['requests'] ?? [], $a['room_creations'] ?? [], [0]));
                $lastB = max(array_merge($b['requests'] ?? [], $b['room_creations'] ?? [], [0]));
                return $lastA <=> $lastB;
            });
            $data['ips'] = array_slice($data['ips'], -$this->maxTrackedIps, null, true);
        }
    }

    /**
     * Unlike Storage::load() (which throws on corrupted content to avoid
     * silently wiping live P2P sessions), a corrupted/unreadable rate-limit
     * file is treated as empty here. Losing rate-limit counters only
     * temporarily weakens throttling until the next window -- self-healing,
     * and far lower stakes than losing session state. Failing closed here
     * (throwing, like Storage does) would instead take the whole signaling
     * node down over a non-essential bookkeeping file.
     *
     * Reads from an already-`flock`'d handle (opened 'c+' by
     * checkAndRecord) rather than a fresh file_get_contents, so the read is
     * part of the same locked critical section as the eventual write --
     * see the Section C4 note on checkAndRecord above.
     */
    private function loadFromHandle($handle): array
    {
        rewind($handle);
        $content = stream_get_contents($handle);
        if ($content === false || $content === '') {
            return ['ips' => []];
        }
        $data = json_decode($content, true);
        return is_array($data) && isset($data['ips']) && is_array($data['ips']) ? $data : ['ips' => []];
    }

    private function saveToHandle($handle, array $data): bool
    {
        $json = json_encode($data, JSON_PRETTY_PRINT);
        if ($json === false) {
            return false;
        }
        rewind($handle);
        if (fwrite($handle, $json) === false) {
            return false;
        }
        ftruncate($handle, ftell($handle));
        return true;
    }
}
