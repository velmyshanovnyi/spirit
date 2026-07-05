<?php
/**
 * Live verification harness for specs/phase1/mvp.md, Section 8 (CORS).
 * Not part of the production signaling node -- delete after use.
 *
 * Exercises Cors::applyHeaders under three configurations, selected via a
 * query param (mode=allowed|disallowed|same-origin), so the verifier can
 * send real Origin headers with curl and inspect the actual HTTP response
 * headers -- this is an HTTP-level concern, so testing it over real HTTP
 * against real headers is more faithful than a unit test would be anyway.
 */

require __DIR__ . '/../library/Cors.php';

use Spirit\Cors;

$mode = $_GET['mode'] ?? 'allowed';
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? null;

$allowedOrigins = $mode === 'same-origin' ? [] : ['https://allowed.example'];

Cors::applyHeaders($requestOrigin, $allowedOrigins);

header('Content-Type: application/json');
echo json_encode(['mode' => $mode, 'requestOrigin' => $requestOrigin]);
