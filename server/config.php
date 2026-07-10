<?php

/**
 * Node configuration. Copy/edit per deployment -- this file itself is a
 * safe MVP default (same-origin CORS, global access, fetch_proof disabled).
 */

$dataDir = __DIR__ . '/data';

return [
    'DB_FILE' => $dataDir . '/database.json',
    'RATE_LIMIT_FILE' => $dataDir . '/ratelimit.json',
    'LOCK_FILE' => $dataDir . '/signaling.lock',
    'SESSION_TTL_SECONDS' => 300,
    'MAX_SESSIONS' => 1000,

    // Access control (docs/signaling-protocol.md "Контроль доступу").
    // Default: open node relying solely on per-room invite tokens.
    'GLOBAL_ACCESS' => true,
    'WHITE_LIST' => [],

    // CORS (docs/signaling-protocol.md "Транспорт і CORS"). Empty = same-origin
    // deploy, no CORS headers ever sent. Never put '*' in this list.
    // localhost:5500 permanently allowed: the local dev preview server used
    // for live 2-browser testing against the real production backend
    // (docs/deploy notes) -- not a public origin, no exposure to real users.
    'ALLOWED_ORIGINS' => ['http://localhost:5500'],

    'RATE_LIMIT' => [
        'REQUEST_WINDOW_SECONDS' => 60,
        'MAX_REQUESTS_PER_WINDOW' => 20,
        'ROOM_CREATION_WINDOW_SECONDS' => 3600,
        // Raised from the original 10: our own dev/testing traffic
        // (deploy smoke-checks + live 2-browser tests) routinely hit that
        // ceiling. Still a real anti-abuse limit, just not testing-hostile.
        'MAX_ROOM_CREATIONS_PER_WINDOW' => 100,
        'MAX_TRACKED_IPS' => 10000,
    ],

    // fetch_proof (docs/identity-verification.md) is an elevated-risk,
    // opt-in proxy. Off by default -- enable deliberately.
    'ENABLE_PROOF_PROXY' => false,
    'FETCH_PROOF' => [
        'TIMEOUT_SECONDS' => 5,
        'MAX_BYTES' => 65536,
        'MAX_REDIRECTS' => 2,
    ],
];
