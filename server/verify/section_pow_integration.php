<?php
/**
 * Live verification harness for specs/phase5/sybil-resistance.md, Section
 * SR2 (create_invite integration: PoW gate + anti-replay). Kept in the repo
 * permanently, matching the established precedent of section9_rate_limiter.php/
 * section_pow.php (still present since their sections landed -- these are
 * not transient scratch files).
 *
 * Exercises SignalingController::handle() directly (not a real HTTP round
 * trip) against isolated tmp data files, so it's fast and side-effect-free
 * on the node's real database.json/ratelimit.json/pow_spent.json. The
 * README-level live check (an actual HTTP POST to the deployed
 * server/public/index.php on kolomedi/kibr) is done separately per
 * CLAUDE.md's live-verification requirement for this section.
 */

require __DIR__ . '/../library/Storage.php';
require __DIR__ . '/../library/InviteManager.php';
require __DIR__ . '/../library/Cors.php';
require __DIR__ . '/../library/RateLimiter.php';
require __DIR__ . '/../library/Pow.php';
require __DIR__ . '/../library/PowNonceStore.php';
require __DIR__ . '/../library/SignalingController.php';

use Spirit\Pow;
use Spirit\PowNonceStore;
use Spirit\SignalingController;

header('Content-Type: application/json');

$dbFile = __DIR__ . '/tmp_section_pow_integration_db.json';
$rateLimitFile = __DIR__ . '/tmp_section_pow_integration_ratelimit.json';
$powSpentFile = __DIR__ . '/tmp_section_pow_integration_pow_spent.json';
$lockFile = __DIR__ . '/tmp_section_pow_integration.lock';

$results = [];

function makeController(string $dbFile, string $rateLimitFile, string $powSpentFile, string $lockFile, int $windowSeconds = 30, int $difficultyBits = 8): SignalingController
{
    $config = [
        'DB_FILE' => $dbFile,
        'RATE_LIMIT_FILE' => $rateLimitFile,
        'POW_SPENT_FILE' => $powSpentFile,
        'LOCK_FILE' => $lockFile,
        'SESSION_TTL_SECONDS' => 300,
        'MAX_SESSIONS' => 1000,
        'POW_WINDOW_SECONDS' => $windowSeconds,
        'POW_DIFFICULTY_BITS' => $difficultyBits,
        'GLOBAL_ACCESS' => true,
        'WHITE_LIST' => [],
        'ALLOWED_ORIGINS' => [],
        'RATE_LIMIT' => [
            'REQUEST_WINDOW_SECONDS' => 60,
            'MAX_REQUESTS_PER_WINDOW' => 1000,
            'ROOM_CREATION_WINDOW_SECONDS' => 3600,
            'MAX_ROOM_CREATIONS_PER_WINDOW' => 1000,
            'MAX_TRACKED_IPS' => 10000,
        ],
        'ENABLE_PROOF_PROXY' => false,
        'FETCH_PROOF' => ['TIMEOUT_SECONDS' => 5, 'MAX_BYTES' => 65536, 'MAX_REDIRECTS' => 2],
        'ADMIN_PASSWORD_HASH' => '',
        'ADMIN_TOKEN_SECRET' => '',
        'ADMIN_TOKEN_TTL_SECONDS' => 900,
    ];
    return new SignalingController($config);
}

function solvePowForTest(string $challenge, int $difficultyBits): string
{
    for ($n = 0; $n < 5_000_000; $n++) {
        $nonce = (string) $n;
        if (Pow::verify($challenge, $nonce, $difficultyBits)) {
            return $nonce;
        }
    }
    throw new \RuntimeException('could not solve test PoW');
}

function cleanupTmpFiles(array $files): void
{
    foreach ($files as $f) {
        if (file_exists($f)) {
            @unlink($f);
        }
    }
}

cleanupTmpFiles([$dbFile, $rateLimitFile, $powSpentFile, $lockFile]);

try {
    $difficultyBits = 8; // low, test-only difficulty so this harness runs fast
    $windowSeconds = 30;

    // 1. Missing PoW fields entirely -> 400.
    $controller = makeController($dbFile, $rateLimitFile, $powSpentFile, $lockFile, $windowSeconds, $difficultyBits);
    $resp = $controller->handle('POST', null, '203.0.113.1', [
        'action' => 'create_invite',
        'sender_key' => 'senderA',
    ]);
    $results['missing_pow_fields_rejected_400'] = $resp['status'] === 400;

    // 2. Well-formed but wrong-difficulty (i.e. simply invalid) PoW -> 400.
    $now = time();
    $timeWindow = intdiv($now, $windowSeconds);
    $challenge = Pow::buildChallenge($timeWindow, 'senderB');
    $resp = $controller->handle('POST', null, '203.0.113.2', [
        'action' => 'create_invite',
        'sender_key' => 'senderB',
        'pow_timestamp' => $now,
        'pow_nonce' => 'definitely-not-a-valid-solution',
    ]);
    $results['invalid_pow_rejected_400'] = $resp['status'] === 400;

    // 3. Valid PoW -> success, room actually created (same as pre-SR2 behavior).
    $senderC = 'senderC';
    $challengeC = Pow::buildChallenge($timeWindow, $senderC);
    $nonceC = solvePowForTest($challengeC, $difficultyBits);
    $resp = $controller->handle('POST', null, '203.0.113.3', [
        'action' => 'create_invite',
        'sender_key' => $senderC,
        'pow_timestamp' => $now,
        'pow_nonce' => $nonceC,
    ]);
    $results['valid_pow_succeeds'] = $resp['status'] === 200
        && ($resp['body']['status'] ?? null) === 'success'
        && !empty($resp['body']['room_id'])
        && !empty($resp['body']['invite_token']);

    // 4. Replaying the EXACT same (timeWindow, sender_key, nonce) a second
    // time -> 400 (anti-replay), even though the PoW math itself is still
    // valid -- this is the core Sybil-defeating property.
    $resp = $controller->handle('POST', null, '198.51.100.9', [ // different IP on purpose
        'action' => 'create_invite',
        'sender_key' => $senderC,
        'pow_timestamp' => $now,
        'pow_nonce' => $nonceC,
    ]);
    $results['replayed_pow_rejected_400'] = $resp['status'] === 400;

    // 5. A stale pow_timestamp (outside the 2*windowSeconds tolerance) ->
    // 400 even with an otherwise-valid PoW for that (wrong) window.
    $staleTimestamp = $now - (3 * $windowSeconds);
    $staleWindow = intdiv($staleTimestamp, $windowSeconds);
    $senderD = 'senderD';
    $challengeD = Pow::buildChallenge($staleWindow, $senderD);
    $nonceD = solvePowForTest($challengeD, $difficultyBits);
    $resp = $controller->handle('POST', null, '203.0.113.4', [
        'action' => 'create_invite',
        'sender_key' => $senderD,
        'pow_timestamp' => $staleTimestamp,
        'pow_nonce' => $nonceD,
    ]);
    $results['stale_timestamp_rejected_400'] = $resp['status'] === 400;

    // 6. A DIFFERENT sender_key with the SAME nonce for the same window is a
    // completely separate PoW (challenge string includes sender_key) and
    // must independently succeed if it's actually a valid solution for that
    // sender's own challenge -- i.e. anti-replay keys on the full triple,
    // not just the nonce.
    $senderE = 'senderE';
    $challengeE = Pow::buildChallenge($timeWindow, $senderE);
    $nonceE = solvePowForTest($challengeE, $difficultyBits);
    $resp = $controller->handle('POST', null, '203.0.113.5', [
        'action' => 'create_invite',
        'sender_key' => $senderE,
        'pow_timestamp' => $now,
        'pow_nonce' => $nonceE,
    ]);
    $results['different_sender_key_independent_pow_succeeds'] = $resp['status'] === 200;

    // PowNonceStore GC/TTL behavior, mirroring section9_rate_limiter.php's
    // style: short window so the harness can observe expiry quickly.
    $gcSpentFile = __DIR__ . '/tmp_section_pow_integration_gc.json';
    cleanupTmpFiles([$gcSpentFile]);
    $store = new PowNonceStore($gcSpentFile, 2);
    $store->checkAndMarkSpent('1', 'gcSender', 'nonce1');
    $rawBeforeGc = json_decode(file_get_contents($gcSpentFile), true);
    $results['spent_entry_recorded'] = count($rawBeforeGc['spent'] ?? []) === 1;

    sleep(3); // past the 2s TTL
    $store->checkAndMarkSpent('1', 'otherSender', 'nonce2'); // triggers GC on write
    $rawAfterGc = json_decode(file_get_contents($gcSpentFile), true);
    $results['stale_spent_entry_gced'] = count($rawAfterGc['spent'] ?? []) === 1; // only the fresh one remains
    cleanupTmpFiles([$gcSpentFile]);

    $results['all_passed'] = !in_array(false, $results, true);
} finally {
    cleanupTmpFiles([$dbFile, $rateLimitFile, $powSpentFile, $lockFile]);
}

echo json_encode($results, JSON_PRETTY_PRINT);
