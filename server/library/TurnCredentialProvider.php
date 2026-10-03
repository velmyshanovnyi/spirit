<?php

declare(strict_types=1);

namespace Spirit;

/**
 * Section I2 (specs/phase5/ice-servers.md): short-lived Cloudflare Realtime
 * TURN credentials for the signaling node's clients.
 *
 * The Cloudflare API token is a server-side secret (config.secrets.php,
 * gitignored); clients only ever see the generated, TTL-bounded
 * username/credential pair. One generated pair is cached in an ephemeral
 * JSON file and re-served until HALF its TTL has elapsed (the client
 * refreshes on the same half-TTL rule, so a credential handed out at the
 * last moment still has >= TTL/2 of life left) -- no persistent user data,
 * same ephemeral-file tier as ratelimit.json / pow_spent.json.
 *
 * Degrades to an EMPTY server list (HTTP 200) when the keys are unset or
 * the vendor call fails: the client then runs on its static STUN + Open
 * Relay list (iceServers.js). Never throws out of getIceServers().
 *
 * The HTTP transport is injectable (constructor) so the verify harness can
 * exercise caching/expiry/failure without network access.
 */
final class TurnCredentialProvider
{
    private const CLOUDFLARE_ENDPOINT = 'https://rtc.live.cloudflare.com/v1/turn/keys/%s/credentials/generate-ice-servers';

    private string $keyId;
    private string $apiToken;
    private int $ttlSeconds;
    private string $cacheFile;
    /** @var callable(string $url, array $headers, string $jsonBody, int $timeoutSeconds): ?string */
    private $transport;
    /** @var callable(): int */
    private $clock;

    /**
     * @param callable|null $transport fn(url, headers, jsonBody, timeoutSeconds) => response body string or null on failure
     * @param callable|null $clock     fn() => unix seconds
     */
    public function __construct(
        string $keyId,
        string $apiToken,
        int $ttlSeconds,
        string $cacheFile,
        ?callable $transport = null,
        ?callable $clock = null
    ) {
        $this->keyId = $keyId;
        $this->apiToken = $apiToken;
        $this->ttlSeconds = max(60, $ttlSeconds);
        $this->cacheFile = $cacheFile;
        $this->transport = $transport ?? [$this, 'curlPost'];
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function isConfigured(): bool
    {
        return $this->keyId !== '' && $this->apiToken !== '';
    }

    /**
     * @return array{iceServers: array<int, array{urls: mixed, username?: string, credential?: string}>, expiresAt: ?int}
     */
    public function getIceServers(): array
    {
        if (!$this->isConfigured()) {
            return ['iceServers' => [], 'expiresAt' => null];
        }
        $now = ($this->clock)();
        $cached = $this->loadCache();
        if ($cached !== null && $this->isFresh($cached, $now)) {
            return ['iceServers' => $cached['iceServers'], 'expiresAt' => $cached['expiresAt']];
        }
        $generated = $this->generate($now);
        if ($generated === null) {
            // Vendor unreachable: a not-yet-expired (but past half-TTL) cache
            // is still better than nothing -- the client's own half-TTL
            // refresh will simply retry on its next connection.
            if ($cached !== null && $cached['expiresAt'] > $now) {
                return ['iceServers' => $cached['iceServers'], 'expiresAt' => $cached['expiresAt']];
            }
            return ['iceServers' => [], 'expiresAt' => null];
        }
        $this->saveCache($generated);
        // Same public shape as the cache-hit path (review iter1): issuedAt is
        // cache bookkeeping, not part of the client contract.
        return ['iceServers' => $generated['iceServers'], 'expiresAt' => $generated['expiresAt']];
    }

    /** @param array{iceServers: array, expiresAt: int, issuedAt: int} $cached */
    private function isFresh(array $cached, int $now): bool
    {
        $halfLife = $cached['issuedAt'] + intdiv($cached['expiresAt'] - $cached['issuedAt'], 2);
        return $now < $halfLife;
    }

    /** @return array{iceServers: array, expiresAt: int, issuedAt: int}|null */
    private function generate(int $now): ?array
    {
        $url = sprintf(self::CLOUDFLARE_ENDPOINT, rawurlencode($this->keyId));
        $headers = [
            'Authorization: Bearer ' . $this->apiToken,
            'Content-Type: application/json',
        ];
        $body = json_encode(['ttl' => $this->ttlSeconds]);
        $response = ($this->transport)($url, $headers, (string) $body, 10);
        if (!is_string($response)) {
            return null;
        }
        $decoded = json_decode($response, true);
        if (!is_array($decoded) || !isset($decoded['iceServers']) || !is_array($decoded['iceServers'])) {
            return null;
        }
        // Cloudflare returns either one object or a list of objects; normalise
        // to a list and keep only well-formed TURN entries (urls + both
        // credential fields) -- never relay arbitrary vendor JSON to clients.
        $raw = array_is_list($decoded['iceServers']) ? $decoded['iceServers'] : [$decoded['iceServers']];
        $servers = [];
        foreach ($raw as $entry) {
            if (!is_array($entry) || !isset($entry['urls'], $entry['username'], $entry['credential'])) {
                continue;
            }
            if (!is_string($entry['username']) || !is_string($entry['credential'])) {
                continue;
            }
            $urls = $entry['urls'];
            if (is_string($urls)) {
                $urls = [$urls];
            }
            if (!is_array($urls) || $urls === []) {
                continue;
            }
            $urls = array_values(array_filter($urls, static fn ($u): bool => is_string($u) && preg_match('#^turns?:#', $u) === 1));
            if ($urls === []) {
                continue;
            }
            $servers[] = ['urls' => $urls, 'username' => $entry['username'], 'credential' => $entry['credential']];
        }
        if ($servers === []) {
            return null;
        }
        return ['iceServers' => $servers, 'expiresAt' => $now + $this->ttlSeconds, 'issuedAt' => $now];
    }

    /** @return array{iceServers: array, expiresAt: int, issuedAt: int}|null */
    private function loadCache(): ?array
    {
        if (!is_file($this->cacheFile)) {
            return null;
        }
        $raw = @file_get_contents($this->cacheFile);
        if ($raw === false) {
            return null;
        }
        $data = json_decode($raw, true);
        if (!is_array($data) || !isset($data['iceServers'], $data['expiresAt'], $data['issuedAt'])
            || !is_array($data['iceServers']) || !is_int($data['expiresAt']) || !is_int($data['issuedAt'])) {
            return null;
        }
        return $data;
    }

    /** @param array{iceServers: array, expiresAt: int, issuedAt: int} $data */
    private function saveCache(array $data): void
    {
        // tmp-then-rename, same atomic pattern as PowNonceStore. Best effort:
        // a failed cache write only costs one extra vendor call next time.
        $tmp = $this->cacheFile . '.' . bin2hex(random_bytes(4)) . '.tmp';
        $json = json_encode($data);
        if ($json === false || @file_put_contents($tmp, $json, LOCK_EX) === false) {
            return;
        }
        if (!@rename($tmp, $this->cacheFile)) {
            @unlink($tmp);
        }
    }

    /** Default transport: HTTPS POST via curl. Returns the body or null. */
    private function curlPost(string $url, array $headers, string $jsonBody, int $timeoutSeconds): ?string
    {
        if (!function_exists('curl_init')) {
            return null;
        }
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $jsonBody,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => $timeoutSeconds,
            CURLOPT_CONNECTTIMEOUT => $timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if (!is_string($body) || $status < 200 || $status >= 300) {
            return null;
        }
        return $body;
    }
}
