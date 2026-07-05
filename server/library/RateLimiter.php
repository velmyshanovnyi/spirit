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

    public function __construct(
        string $rateLimitFile,
        int $requestWindowSeconds = 60,
        int $maxRequestsPerWindow = 20,
        int $roomCreationWindowSeconds = 3600,
        int $maxRoomCreationsPerWindow = 10
    ) {
        $this->rateLimitFile = $rateLimitFile;
        $this->requestWindowSeconds = $requestWindowSeconds;
        $this->maxRequestsPerWindow = $maxRequestsPerWindow;
        $this->roomCreationWindowSeconds = $roomCreationWindowSeconds;
        $this->maxRoomCreationsPerWindow = $maxRoomCreationsPerWindow;
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

    private function checkAndRecord(string $ip, string $bucket, int $windowSeconds, int $maxCount): bool
    {
        $now = time();
        $data = $this->load();

        $timestamps = $this->filterWindow($data['ips'][$ip][$bucket] ?? [], $now, $windowSeconds);
        $allowed = count($timestamps) < $maxCount;
        $timestamps[] = $now;
        $data['ips'][$ip][$bucket] = $timestamps;

        $this->gcStaleEntries($data, $now);
        $this->save($data);

        return $allowed;
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
    }

    /**
     * Unlike Storage::load() (which throws on corrupted content to avoid
     * silently wiping live P2P sessions), a corrupted/unreadable rate-limit
     * file is treated as empty here. Losing rate-limit counters only
     * temporarily weakens throttling until the next window -- self-healing,
     * and far lower stakes than losing session state. Failing closed here
     * (throwing, like Storage does) would instead take the whole signaling
     * node down over a non-essential bookkeeping file.
     */
    private function load(): array
    {
        if (!file_exists($this->rateLimitFile)) {
            return ['ips' => []];
        }
        $content = @file_get_contents($this->rateLimitFile);
        if ($content === false || $content === '') {
            return ['ips' => []];
        }
        $data = json_decode($content, true);
        return is_array($data) && isset($data['ips']) && is_array($data['ips']) ? $data : ['ips' => []];
    }

    private function save(array $data): bool
    {
        $json = json_encode($data, JSON_PRETTY_PRINT);
        if ($json === false) {
            return false;
        }
        $tmpFile = $this->rateLimitFile . '.tmp.' . bin2hex(random_bytes(8));
        if (file_put_contents($tmpFile, $json, LOCK_EX) === false) {
            @unlink($tmpFile);
            return false;
        }
        if (!rename($tmpFile, $this->rateLimitFile)) {
            @unlink($tmpFile);
            return false;
        }
        return true;
    }
}
