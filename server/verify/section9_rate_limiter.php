<?php
/**
 * Live verification harness for specs/phase1/mvp.md, Section 9 (RateLimiter).
 * Not part of the production signaling node -- delete after use.
 *
 * Uses short windows (2s) so the harness can observe window-reset behavior
 * without an impractically long-running request. Sequential/single-process,
 * so it cannot exercise concurrent-worker races -- see the best-effort
 * caveat in signaling-protocol.md; that gap is accepted, not this
 * harness's job to close.
 */

require __DIR__ . '/../library/RateLimiter.php';

use Spirit\RateLimiter;

header('Content-Type: application/json');

$rateLimitFile = __DIR__ . '/tmp_section9_test.json';
$results = [];

try {
    if (file_exists($rateLimitFile)) {
        unlink($rateLimitFile);
    }

    // requestWindow=2s max=3, roomCreationWindow=2s max=2
    $limiter = new RateLimiter($rateLimitFile, 2, 3, 2, 2);
    $ip = '203.0.113.5';

    $requestOutcomes = [];
    for ($i = 0; $i < 4; $i++) {
        $requestOutcomes[] = $limiter->checkAndRecordRequest($ip);
    }
    $results['first_3_requests_allowed_4th_denied'] = $requestOutcomes === [true, true, true, false];

    $otherIp = '198.51.100.9';
    $results['different_ip_has_independent_bucket'] = $limiter->checkAndRecordRequest($otherIp) === true;

    $roomOutcomes = [];
    for ($i = 0; $i < 3; $i++) {
        $roomOutcomes[] = $limiter->checkAndRecordRoomCreation($ip);
    }
    $results['first_2_room_creations_allowed_3rd_denied'] = $roomOutcomes === [true, true, false];

    sleep(3); // past both 2s windows

    $results['request_allowed_again_after_window_expires'] = $limiter->checkAndRecordRequest($ip) === true;
    $results['room_creation_allowed_again_after_window_expires'] = $limiter->checkAndRecordRoomCreation($ip) === true;

    // After the sleep, otherIp's lone old timestamp is stale everywhere and
    // should have been garbage-collected out of the file entirely by any of
    // the checkAndRecord* calls above.
    $raw = json_decode(file_get_contents($rateLimitFile), true);
    $results['stale_ip_entries_are_gced'] = !isset($raw['ips'][$otherIp]);

    $results['all_passed'] = !in_array(false, $results, true);
} finally {
    if (file_exists($rateLimitFile)) {
        @unlink($rateLimitFile);
    }
}

echo json_encode($results, JSON_PRETTY_PRINT);
