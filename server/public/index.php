<?php
/**
 * Spirit signaling node entrypoint. See docs/signaling-protocol.md for the
 * wire protocol. This file only wires HTTP <-> SignalingController; all
 * logic lives in server/library/.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');

require __DIR__ . '/../library/Storage.php';
require __DIR__ . '/../library/InviteManager.php';
require __DIR__ . '/../library/Cors.php';
require __DIR__ . '/../library/RateLimiter.php';
require __DIR__ . '/../library/SignalingController.php';

use Spirit\SignalingController;

$config = require __DIR__ . '/../config.php';
$controller = new SignalingController($config);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$origin = $_SERVER['HTTP_ORIGIN'] ?? null;
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';

$rawInput = file_get_contents('php://input');
$input = json_decode((string) $rawInput, true);
if (!is_array($input)) {
    $input = [];
}

$result = $controller->handle($method, $origin, $clientIp, $input);

http_response_code($result['status']);
header('Content-Type: application/json; charset=UTF-8');
if ($result['body'] !== null) {
    echo json_encode($result['body']);
}
