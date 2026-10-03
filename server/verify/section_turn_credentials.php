<?php
/**
 * Verification harness for specs/phase5/ice-servers.md, Section I2
 * (TurnCredentialProvider). Not part of the production signaling node.
 * Runs with an injected transport + clock, so no network / no real token.
 *
 *   php server/verify/section_turn_credentials.php
 */

declare(strict_types=1);

require __DIR__ . '/../library/TurnCredentialProvider.php';

use Spirit\TurnCredentialProvider;

$cacheFile = __DIR__ . '/tmp_turn_credentials_test.json';
$results = [];
$cleanup = static function () use ($cacheFile): void {
    foreach (glob($cacheFile . '*') ?: [] as $f) {
        @unlink($f);
    }
};
$cleanup();

try {
    // 1. Not configured -> empty list, no transport call, no cache file.
    $calls = 0;
    $neverTransport = static function () use (&$calls): ?string {
        $calls++;
        return '{}';
    };
    $unconfigured = new TurnCredentialProvider('', '', 86400, $cacheFile, $neverTransport, static fn (): int => 1000);
    $r = $unconfigured->getIceServers();
    $results['unconfigured_returns_empty_without_calling_vendor'] =
        $r === ['iceServers' => [], 'expiresAt' => null] && $calls === 0 && !is_file($cacheFile);

    // 2. Configured, vendor answers -> normalised list, cached, half-TTL honoured.
    $now = 1000;
    $clock = static function () use (&$now): int {
        return $now;
    };
    $vendorCalls = [];
    $okTransport = static function (string $url, array $headers, string $body, int $timeout) use (&$vendorCalls): ?string {
        $vendorCalls[] = ['url' => $url, 'auth' => $headers[0] ?? null, 'body' => json_decode($body, true)];
        return json_encode(['iceServers' => [
            'urls' => ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'stun:turn.cloudflare.com:3478'],
            'username' => 'cf-user',
            'credential' => 'cf-pass',
        ]]);
    };
    $provider = new TurnCredentialProvider('KEY123', 'TOKEN-abc', 86400, $cacheFile, $okTransport, $clock);
    $first = $provider->getIceServers();
    $results['vendor_called_with_key_in_url_bearer_token_and_ttl'] =
        count($vendorCalls) === 1
        && str_contains($vendorCalls[0]['url'], '/turn/keys/KEY123/credentials/generate-ice-servers')
        && $vendorCalls[0]['auth'] === 'Authorization: Bearer TOKEN-abc'
        && ($vendorCalls[0]['body']['ttl'] ?? null) === 86400;
    $results['response_normalised_to_turn_only_entry_with_expiry'] =
        $first['expiresAt'] === 1000 + 86400
        && count($first['iceServers']) === 1
        && $first['iceServers'][0]['username'] === 'cf-user'
        && $first['iceServers'][0]['credential'] === 'cf-pass'
        && $first['iceServers'][0]['urls'] === ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'];
    $results['cache_file_written'] = is_file($cacheFile);
    $results['fresh_generate_has_same_public_shape_as_cache_hit'] = array_keys($first) === ['iceServers', 'expiresAt'];

    // 3. Within half-TTL: served from cache, vendor NOT called again (fresh instance = fresh process).
    $now = 1000 + 43199;
    $provider2 = new TurnCredentialProvider('KEY123', 'TOKEN-abc', 86400, $cacheFile, $okTransport, $clock);
    $second = $provider2->getIceServers();
    $results['within_half_ttl_served_from_cache'] = count($vendorCalls) === 1 && $second === ['iceServers' => $first['iceServers'], 'expiresAt' => $first['expiresAt']];

    // 4. Past half-TTL: regenerated (vendor called), new expiry.
    $now = 1000 + 43200;
    $third = $provider2->getIceServers();
    $results['past_half_ttl_regenerates'] = count($vendorCalls) === 2 && $third['expiresAt'] === $now + 86400;

    // 5. Vendor fails past half-TTL but before expiry: stale-but-valid cache is still served.
    $failTransport = static fn (): ?string => null;
    $now = $third['expiresAt'] - 10;
    $provider3 = new TurnCredentialProvider('KEY123', 'TOKEN-abc', 86400, $cacheFile, $failTransport, $clock);
    $stale = $provider3->getIceServers();
    $results['vendor_failure_serves_unexpired_cache'] = $stale['expiresAt'] === $third['expiresAt'] && count($stale['iceServers']) === 1;

    // 6. Vendor fails after expiry: empty list, no exception.
    $now = $third['expiresAt'] + 1;
    $expired = $provider3->getIceServers();
    $results['vendor_failure_after_expiry_returns_empty'] = $expired === ['iceServers' => [], 'expiresAt' => null];

    // 7. Malformed vendor JSON -> treated as failure (empty on cold cache).
    $cleanup();
    $garbage = new TurnCredentialProvider('K', 'T', 3600, $cacheFile, static fn (): ?string => '{"nope":1}', $clock);
    $results['malformed_vendor_response_returns_empty'] = $garbage->getIceServers() === ['iceServers' => [], 'expiresAt' => null];
} finally {
    $cleanup();
}

$allPassed = !in_array(false, $results, true);
echo json_encode(['all_passed' => $allPassed, 'results' => $results], JSON_PRETTY_PRINT), PHP_EOL;
exit($allPassed ? 0 : 1);
