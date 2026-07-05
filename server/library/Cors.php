<?php

namespace Spirit;

/**
 * CORS policy per docs/signaling-protocol.md: same-origin deploys need no
 * CORS headers at all (default recommendation). Cross-origin deploys must
 * configure an explicit ALLOWED_ORIGINS list; the Origin header is reflected
 * back only on an exact match. `Access-Control-Allow-Origin: *` is never
 * emitted by this class.
 */
class Cors
{
    /**
     * @param string[] $allowedOrigins
     */
    public static function applyHeaders(?string $requestOrigin, array $allowedOrigins): void
    {
        if ($requestOrigin === null || $allowedOrigins === []) {
            return;
        }
        if (!in_array($requestOrigin, $allowedOrigins, true)) {
            return;
        }

        header('Access-Control-Allow-Origin: ' . $requestOrigin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
}
