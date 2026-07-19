<?php

/**
 * Node configuration. Copy/edit per deployment -- this file itself is a
 * safe MVP default (same-origin CORS, global access, fetch_proof disabled).
 */

$dataDir = __DIR__ . '/data';

$config = [
    'DB_FILE' => $dataDir . '/database.json',
    'RATE_LIMIT_FILE' => $dataDir . '/ratelimit.json',
    'POW_SPENT_FILE' => $dataDir . '/pow_spent.json',
    'LOCK_FILE' => $dataDir . '/signaling.lock',
    'SESSION_TTL_SECONDS' => 300,
    'MAX_SESSIONS' => 1000,

    // Section SR2 (specs/phase5/sybil-resistance.md): proof-of-work gate on
    // create_invite. POW_WINDOW_SECONDS MUST exactly match
    // client/js/signalingClient.js's hardcoded POW_WINDOW_SECONDS constant
    // (no shared-constants file across JS/PHP in this project) -- a
    // mismatch would bucket legitimate clients into the wrong time window
    // and fail their PoW verification. POW_DIFFICULTY_BITS similarly must
    // match the client's hardcoded POW_DIFFICULTY_BITS, or legitimate
    // clients will solve at the wrong (too easy, rejected; or too hard,
    // needlessly slow) difficulty.
    'POW_WINDOW_SECONDS' => 30,
    'POW_DIFFICULTY_BITS' => 20,

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
        // Raised from the original 20: pollForAnswer (client/js/signalingClient.js)
        // polls check_answer every 3000ms while waiting for a peer, which
        // alone is ~20 requests/60s -- a SINGLE waiting initiator on an IP
        // used the entire old budget with zero headroom for create_invite/
        // create_offer or a second concurrent session on the same IP (e.g.
        // two people behind the same NAT, or our own 2-browser live tests).
        // 100 gives roughly 5x that single-flow cost as headroom -- see
        // docs/signaling-protocol.md "Вартість одного потоку в запитах" for
        // the measured per-flow numbers this is based on.
        'MAX_REQUESTS_PER_WINDOW' => 100,
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

    // Read-only admin panel (specs/ui/server-admin-panel.md): lets whoever
    // knows this password view (never edit -- config stays FTP/file-only)
    // operational parameters at /#/server. Empty hash = feature disabled
    // (matches ENABLE_PROOF_PROXY's off-by-default pattern). The real
    // hash/secret are NEVER committed here -- see config.secrets.php below,
    // same gitignored-local-file pattern as deploy/*.local.* credentials.
    'ADMIN_PASSWORD_HASH' => '',
    // Signs the short-lived admin token returned by admin_login -- a
    // separate secret from the password hash on purpose: different
    // rotation lifecycle, and a leaked token-signing key alone can't be
    // used to derive or brute-force the admin password.
    'ADMIN_TOKEN_SECRET' => '',
    'ADMIN_TOKEN_TTL_SECONDS' => 900,
];

// Optional per-deployment secrets overlay, gitignored (server/*.secrets.php)
// -- keeps real credentials (admin password hash, token-signing secret) out
// of git entirely, mirroring deploy/*.local.* for FTP credentials. Absent
// by default, so a fresh checkout has the admin panel safely disabled.
$secretsFile = __DIR__ . '/config.secrets.php';
if (is_file($secretsFile)) {
    $config = array_replace($config, require $secretsFile);
}

return $config;
