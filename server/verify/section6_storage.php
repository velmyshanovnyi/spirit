<?php
/**
 * Live verification harness for specs/phase1/mvp.md, Section 6 (Storage/GC).
 * Not part of the production signaling node -- deployed temporarily to a
 * real host to verify behavior in place of local PHPUnit (see the explicit
 * test-first waiver recorded in specs/phase1/mvp.md). Delete after use.
 */

require __DIR__ . '/../library/Storage.php';

use Spirit\Storage;

header('Content-Type: application/json');

$dbFile = __DIR__ . '/tmp_section6_test.json';
$results = [];

try {
    if (file_exists($dbFile)) {
        unlink($dbFile);
    }

    $results['php_version_supported'] = PHP_VERSION_ID >= 70400;

    $storage = new Storage($dbFile, 2); // short TTL so GC behavior is observable quickly

    $initial = $storage->load();
    $results['load_missing_file_returns_empty_sessions'] = $initial === ['sessions' => []];

    $data = ['sessions' => ['room1' => ['initiator' => 'k1', 'timestamp' => time()]]];
    $saveOk = $storage->save($data);
    $loaded = $storage->load();
    $results['save_load_roundtrip'] = $saveOk && $loaded === $data;

    $db = [
        'sessions' => [
            'expired' => ['timestamp' => time() - 10],
            'fresh' => ['timestamp' => time()],
        ],
    ];
    $cleaned = $storage->gcSessions($db);
    $results['gc_removes_expired_keeps_fresh'] =
        $cleaned === true && !isset($db['sessions']['expired']) && isset($db['sessions']['fresh']);

    $reloaded = $storage->load();
    $results['gc_persists_cleaned_state_to_disk'] =
        !isset($reloaded['sessions']['expired']) && isset($reloaded['sessions']['fresh']);

    $dbNoExpiry = ['sessions' => ['fresh2' => ['timestamp' => time()]]];
    $cleaned2 = $storage->gcSessions($dbNoExpiry);
    $results['gc_is_noop_when_nothing_expired'] = $cleaned2 === false;

    file_put_contents($dbFile, '{not valid json', LOCK_EX);
    $threw = false;
    try {
        $storage->load();
    } catch (\RuntimeException $e) {
        $threw = true;
    }
    $results['load_throws_on_corrupted_content_instead_of_returning_empty'] = $threw;

    $results['all_passed'] = !in_array(false, $results, true);
} finally {
    if (file_exists($dbFile)) {
        @unlink($dbFile);
    }
}

echo json_encode($results, JSON_PRETTY_PRINT);
