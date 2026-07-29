<?php
/**
 * Live verification harness for SignalingController.php -- the file with the
 * most complex logic on the signaling node (dispatch, withLock, PoW gate)
 * and, until this file, the ONLY one in server/verify/ with zero coverage.
 * Section G2 (specs/reviews/spirit-evaluation-triage.md): the B1/B2/C3/C4/C5
 * fixes made earlier in this same triage were verified only via ad-hoc curl
 * requests against a live deploy, with nothing left behind that a future
 * change to this file could be checked against. This script is that missing,
 * reproducible check -- upload, hit once over HTTP (or run via CLI SAPI),
 * delete after use, same as every other server/verify/*.php harness.
 *
 * POW_DIFFICULTY_BITS is set to 0 here (any nonce passes) -- this harness is
 * about SignalingController's dispatch/lock/field-validation logic, not
 * about re-verifying Pow::verify's bit-counting (that's section_pow.php).
 */

require __DIR__ . '/../library/Storage.php';
require __DIR__ . '/../library/InviteManager.php';
require __DIR__ . '/../library/RateLimiter.php';
require __DIR__ . '/../library/PowNonceStore.php';
require __DIR__ . '/../library/Pow.php';
require __DIR__ . '/../library/Cors.php';
require __DIR__ . '/../library/SignalingController.php';

use Spirit\SignalingController;

header('Content-Type: application/json');

$dataDir = __DIR__ . '/tmp_section_signaling_controller_data';
$results = [];

function freshConfig(string $dataDir): array
{
    return [
        'DB_FILE' => $dataDir . '/database.json',
        'RATE_LIMIT_FILE' => $dataDir . '/ratelimit.json',
        'POW_SPENT_FILE' => $dataDir . '/pow_spent.json',
        'LOCK_FILE' => $dataDir . '/signaling.lock',
        'SESSION_TTL_SECONDS' => 300,
        'MAX_SESSIONS' => 1000,
        'POW_WINDOW_SECONDS' => 30,
        'POW_DIFFICULTY_BITS' => 0,
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
}

/** A trivially-valid PoW pair for a fresh sender_key under POW_DIFFICULTY_BITS = 0. */
function trivialPow(): array
{
    return ['pow_timestamp' => time(), 'pow_nonce' => bin2hex(random_bytes(4))];
}

function rmrf(string $dir): void
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $path = $dir . '/' . $entry;
        is_dir($path) ? rmrf($path) : unlink($path);
    }
    rmdir($dir);
}

try {
    rmrf($dataDir);
    mkdir($dataDir, 0777, true);

    // --- Happy path: create_invite -> create_offer -> get_offer -> submit_answer -> check_answer ---
    $controller = new SignalingController(freshConfig($dataDir));

    $initiatorKey = 'sender-' . bin2hex(random_bytes(8));
    $pow = trivialPow();
    $invite = $controller->handle('POST', null, '203.0.113.1', array_merge(
        ['action' => 'create_invite', 'sender_key' => $initiatorKey],
        $pow
    ));
    $results['create_invite_succeeds'] = $invite['status'] === 200
        && isset($invite['body']['room_id'], $invite['body']['invite_token']);
    $roomId = $invite['body']['room_id'] ?? null;
    $inviteToken = $invite['body']['invite_token'] ?? null;

    // --- Section B2: timestamp is refreshed by actions AFTER create_invite,
    // not just written once. Snapshot right after create_invite, force the
    // wall clock forward (time() has 1-second resolution -- without this
    // sleep, create_offer could land in the SAME second and the ">"
    // comparison below would be a false negative, not proof of a bug), then
    // confirm create_offer's refresh actually moved it. ---
    $dbAfterInvite = json_decode(file_get_contents($dataDir . '/database.json'), true);
    $timestampAfterCreateInvite = $dbAfterInvite['sessions'][$roomId]['timestamp'] ?? null;
    sleep(2);

    $offerResult = $controller->handle('POST', null, '203.0.113.1', [
        'action' => 'create_offer',
        'sender_key' => $initiatorKey,
        'room_id' => $roomId,
        'invite_token' => $inviteToken,
        'sdp_data' => 'OFFER_SDP',
        'ecdh_pubkey' => 'INITIATOR_ECDH',
    ]);
    $results['create_offer_succeeds'] = $offerResult['status'] === 200;

    $dbAfterCreateOffer = json_decode(file_get_contents($dataDir . '/database.json'), true);
    $results['B2_create_offer_refreshes_timestamp'] =
        ($dbAfterCreateOffer['sessions'][$roomId]['timestamp'] ?? null) > $timestampAfterCreateInvite;

    $joinerKey = 'sender-' . bin2hex(random_bytes(8));
    $getOfferResult = $controller->handle('POST', null, '203.0.113.2', [
        'action' => 'get_offer',
        'sender_key' => $joinerKey,
        'room_id' => $roomId,
        'invite_token' => $inviteToken,
    ]);
    $results['get_offer_returns_the_published_offer'] = $getOfferResult['status'] === 200
        && ($getOfferResult['body']['offer'] ?? null) === 'OFFER_SDP';

    $answerResult = $controller->handle('POST', null, '203.0.113.2', [
        'action' => 'submit_answer',
        'sender_key' => $joinerKey,
        'room_id' => $roomId,
        'invite_token' => $inviteToken,
        'sdp_data' => 'ANSWER_SDP',
        'ecdh_pubkey' => 'JOINER_ECDH',
    ]);
    $results['submit_answer_succeeds'] = $answerResult['status'] === 200;

    // --- Section B1: check_answer is scoped to the room's recorded initiator ---
    $wrongSenderResult = $controller->handle('POST', null, '198.51.100.9', [
        'action' => 'check_answer',
        'sender_key' => $joinerKey, // the JOINER, not the initiator who created the room
        'room_id' => $roomId,
    ]);
    $results['B1_check_answer_rejects_non_initiator'] = $wrongSenderResult['status'] === 403;

    $rightSenderResult = $controller->handle('POST', null, '203.0.113.1', [
        'action' => 'check_answer',
        'sender_key' => $initiatorKey,
        'room_id' => $roomId,
    ]);
    $results['B1_check_answer_allows_the_real_initiator'] = $rightSenderResult['status'] === 200
        && ($rightSenderResult['body']['answer'] ?? null) === 'ANSWER_SDP';


    // --- Section C3: an oversized field routed through requireFields() is rejected (sdp_data) ---
    $oversizedSdp = str_repeat('a', 70000); // > MAX_FIELD_LENGTH (65536)
    $anotherInvite = $controller->handle('POST', null, '203.0.113.3', array_merge(
        ['action' => 'create_invite', 'sender_key' => 'sender-' . bin2hex(random_bytes(8))],
        trivialPow()
    ));
    $oversizedFieldResult = $controller->handle('POST', null, '203.0.113.3', [
        'action' => 'create_offer',
        'sender_key' => 'sender-' . bin2hex(random_bytes(8)), // wrong on purpose -- length check must fire before this would even matter
        'room_id' => $anotherInvite['body']['room_id'] ?? '',
        'invite_token' => $anotherInvite['body']['invite_token'] ?? '',
        'sdp_data' => $oversizedSdp,
        'ecdh_pubkey' => 'X',
    ]);
    $results['C3_oversized_sdp_data_rejected_400'] = $oversizedFieldResult['status'] === 400;

    // --- Section C3 GAP found while writing this harness (G2): sender_key
    // itself is read directly in handle() BEFORE requireFields() is ever
    // reached, so it was never covered by the C3 length cap. This assertion
    // is written to describe the FIXED behavior -- see the accompanying
    // code change in handle() that makes it pass.
    $oversizedSenderKey = str_repeat('b', 70000);
    $oversizedSenderKeyResult = $controller->handle('POST', null, '203.0.113.4', array_merge(
        ['action' => 'create_invite', 'sender_key' => $oversizedSenderKey],
        trivialPow()
    ));
    $results['C3_oversized_sender_key_rejected_400'] = $oversizedSenderKeyResult['status'] === 400;

    // --- Section C4: PoW nonce anti-replay -- the SAME (timestamp, sender_key, nonce) can't create two invites ---
    $replaySenderKey = 'sender-' . bin2hex(random_bytes(8));
    $replayPow = trivialPow();
    $firstAttempt = $controller->handle('POST', null, '203.0.113.5', array_merge(
        ['action' => 'create_invite', 'sender_key' => $replaySenderKey],
        $replayPow
    ));
    $secondAttempt = $controller->handle('POST', null, '203.0.113.5', array_merge(
        ['action' => 'create_invite', 'sender_key' => $replaySenderKey],
        $replayPow // identical nonce/timestamp -- must be rejected as a replay
    ));
    $results['C4_pow_nonce_replay_rejected'] = $firstAttempt['status'] === 200 && $secondAttempt['status'] === 400;

    // --- Section C5: security-relevant events are logged via error_log() ---
    // check_answer's 403 (wrong-initiator) branch is a per-room
    // authorization decision inside dispatchAction, not one of the events
    // logSecurityEvent is wired to (rate limits, whitelist rejection,
    // SSRF-rejected fetch_proof, storage errors) -- so the event actually
    // asserted on here is a rate-limit rejection, one C5 DOES cover.
    $logFile = $dataDir . '/error_log_capture.txt';
    $previousErrorLog = ini_get('error_log');
    $rateLimitConfig = freshConfig($dataDir);
    $rateLimitConfig['RATE_LIMIT']['MAX_REQUESTS_PER_WINDOW'] = 1;
    $rateLimitController = new SignalingController($rateLimitConfig);
    ini_set('error_log', $logFile);
    $rateLimitController->handle('POST', null, '203.0.113.7', array_merge(
        ['action' => 'create_invite', 'sender_key' => 'rl-sender-1'],
        trivialPow()
    ));
    $rateLimitedResult = $rateLimitController->handle('POST', null, '203.0.113.7', array_merge(
        ['action' => 'create_invite', 'sender_key' => 'rl-sender-1'],
        trivialPow()
    ));
    ini_set('error_log', $previousErrorLog === false ? '' : $previousErrorLog);
    $logContents = is_file($logFile) ? file_get_contents($logFile) : '';
    $results['C5_rate_limit_429_is_logged'] = $rateLimitedResult['status'] === 429
        && strpos($logContents, 'rate_limited') !== false;

    $results['all_passed'] = !in_array(false, $results, true);
} finally {
    rmrf($dataDir);
}

echo json_encode($results, JSON_PRETTY_PRINT);
