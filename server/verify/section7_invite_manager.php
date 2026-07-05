<?php
/**
 * Live verification harness for specs/phase1/mvp.md, Section 7 (InviteManager).
 * Not part of the production signaling node -- delete after use.
 */

require __DIR__ . '/../library/Storage.php';
require __DIR__ . '/../library/InviteManager.php';

use Spirit\Storage;
use Spirit\InviteManager;

header('Content-Type: application/json');

$dbFile = __DIR__ . '/tmp_section7_test.json';
$results = [];

try {
    if (file_exists($dbFile)) {
        unlink($dbFile);
    }

    $storage = new Storage($dbFile, 300);
    $manager = new InviteManager($storage);

    $invite = $manager->createInvite('sender-key-1');
    $results['create_invite_returns_room_and_token'] =
        is_string($invite['roomId']) && strlen($invite['roomId']) === 32 &&
        is_string($invite['inviteToken']) && strlen($invite['inviteToken']) === 32;

    $db = $storage->load();
    $results['created_room_persisted'] = isset($db['sessions'][$invite['roomId']]);
    $results['created_room_not_yet_used'] = $db['sessions'][$invite['roomId']]['invite_used'] === false;

    $results['valid_token_accepted'] = $manager->isTokenValid($db, $invite['roomId'], $invite['inviteToken']);
    $results['wrong_token_rejected'] = $manager->isTokenValid($db, $invite['roomId'], 'not-the-real-token') === false;
    $results['unknown_room_rejected'] = $manager->isTokenValid($db, 'nonexistent-room', $invite['inviteToken']) === false;

    $manager->markInviteUsed($db, $invite['roomId']);
    $results['token_rejected_after_use'] = $manager->isTokenValid($db, $invite['roomId'], $invite['inviteToken']) === false;

    $dbReloaded = $storage->load();
    $results['used_flag_persisted_to_disk'] = $dbReloaded['sessions'][$invite['roomId']]['invite_used'] === true;

    // Whitelist mode
    $results['global_access_allows_anyone'] = $manager->isSenderAllowed('anyone', true, []);
    $results['whitelist_allows_listed_key'] = $manager->isSenderAllowed('key-a', false, ['key-a', 'key-b']);
    $results['whitelist_rejects_unlisted_key'] = $manager->isSenderAllowed('key-z', false, ['key-a', 'key-b']) === false;

    $results['all_passed'] = !in_array(false, $results, true);
} finally {
    if (file_exists($dbFile)) {
        @unlink($dbFile);
    }
}

echo json_encode($results, JSON_PRETTY_PRINT);
