<?php

namespace Spirit;

class Storage
{
    private string $dbFile;
    private int $sessionTtlSeconds;

    public function __construct(string $dbFile, int $sessionTtlSeconds = 300)
    {
        $this->dbFile = $dbFile;
        $this->sessionTtlSeconds = $sessionTtlSeconds;
    }

    /**
     * @throws \RuntimeException if the file exists but is unreadable or its
     *         content is not valid, well-shaped JSON. We deliberately do NOT
     *         collapse "corrupted" into "empty" here: a caller that reads a
     *         corrupted file, mutates the (wrongly empty) result, and saves it
     *         back would silently wipe every live session. An absent file is
     *         the only case treated as legitimately empty.
     */
    public function load(): array
    {
        if (!file_exists($this->dbFile)) {
            return ['sessions' => []];
        }
        $content = @file_get_contents($this->dbFile);
        if ($content === false) {
            throw new \RuntimeException("Storage: failed to read {$this->dbFile}");
        }
        if ($content === '') {
            return ['sessions' => []];
        }
        $data = json_decode($content, true);
        if (!is_array($data) || !isset($data['sessions']) || !is_array($data['sessions'])) {
            throw new \RuntimeException("Storage: corrupted database file {$this->dbFile}");
        }
        return $data;
    }

    /**
     * Writes via a temp file + atomic rename() rather than in-place
     * file_put_contents(..., LOCK_EX). LOCK_EX only excludes other advisory
     * lockers; a concurrent load() (which takes no lock) could still observe
     * a truncated file mid-write. rename() on the same filesystem is atomic,
     * so any reader of $dbFile always sees either the fully-old or the
     * fully-new content, never a partial write -- no read-side lock needed.
     */
    public function save(array $data): bool
    {
        $json = json_encode($data, JSON_PRETTY_PRINT);
        if ($json === false) {
            return false; // e.g. non-UTF-8 content -- never overwrite a good file with empty/partial data
        }

        $tmpFile = $this->dbFile . '.tmp.' . bin2hex(random_bytes(8));
        $written = file_put_contents($tmpFile, $json, LOCK_EX);
        if ($written === false) {
            @unlink($tmpFile);
            return false;
        }
        if (!rename($tmpFile, $this->dbFile)) {
            @unlink($tmpFile);
            return false;
        }
        return true;
    }

    /**
     * Removes sessions older than the TTL. Mutates $db in place and persists
     * to disk only if something was actually removed.
     */
    public function gcSessions(array &$db): bool
    {
        $now = time();
        $cleaned = false;
        foreach ($db['sessions'] as $roomId => $session) {
            if (!isset($session['timestamp']) || $now - $session['timestamp'] > $this->sessionTtlSeconds) {
                unset($db['sessions'][$roomId]);
                $cleaned = true;
            }
        }
        if ($cleaned) {
            $this->save($db);
        }
        return $cleaned;
    }

    /**
     * Hard cap on total session records, independent of TTL (the spec's
     * "максимальний розмір database.json — примусовий GC найстаріших
     * записів при перевищенні"). Evicts the oldest-by-timestamp records
     * first once the count exceeds $maxSessions. Mutates $db in place and
     * persists only if something was actually evicted.
     */
    public function enforceMaxSessions(array &$db, int $maxSessions): bool
    {
        if (count($db['sessions']) <= $maxSessions) {
            return false;
        }
        uasort($db['sessions'], static fn ($a, $b) => ($a['timestamp'] ?? 0) <=> ($b['timestamp'] ?? 0));
        $db['sessions'] = array_slice($db['sessions'], -$maxSessions, null, true);
        $this->save($db);
        return true;
    }
}
