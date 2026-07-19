<?php

namespace Spirit;

/**
 * Orchestrates a single signaling request: CORS, auth (whitelist), rate
 * limiting, and the five wire actions from docs/signaling-protocol.md, plus
 * the optional fetch_proof proxy. Wraps every action that touches
 * database.json in a single exclusive file lock spanning the whole
 * load -> validate -> mutate -> save sequence -- this is what actually
 * closes the invite-token check-then-use TOCTOU race carried forward from
 * Section 7's exec review (InviteManager itself holds no locks by design).
 */
class SignalingController
{
    private array $config;
    private Storage $storage;
    private InviteManager $inviteManager;
    private RateLimiter $rateLimiter;
    private PowNonceStore $powNonceStore;

    public function __construct(array $config)
    {
        $this->config = $config;
        $this->storage = new Storage($config['DB_FILE'], $config['SESSION_TTL_SECONDS']);
        $this->inviteManager = new InviteManager();

        $rl = $config['RATE_LIMIT'];
        $this->rateLimiter = new RateLimiter(
            $config['RATE_LIMIT_FILE'],
            $rl['REQUEST_WINDOW_SECONDS'],
            $rl['MAX_REQUESTS_PER_WINDOW'],
            $rl['ROOM_CREATION_WINDOW_SECONDS'],
            $rl['MAX_ROOM_CREATIONS_PER_WINDOW'],
            $rl['MAX_TRACKED_IPS']
        );

        // Section SR2: TTL matches 2 * POW_WINDOW_SECONDS -- the same
        // tolerance window the pow_timestamp freshness check below uses, so
        // an entry is never GC'd while it could still theoretically pass
        // that freshness check.
        $this->powNonceStore = new PowNonceStore(
            $config['POW_SPENT_FILE'],
            2 * $config['POW_WINDOW_SECONDS']
        );
    }

    /**
     * @return array{status: int, body: array|null}
     */
    public function handle(string $method, ?string $origin, string $clientIp, array $input): array
    {
        Cors::applyHeaders($origin, $this->config['ALLOWED_ORIGINS']);

        // CORS preflight must be short-circuited here, BEFORE the generic
        // "405 on non-POST" rule below -- otherwise a real preflight request
        // gets rejected and the browser never sends the actual POST.
        if ($method === 'OPTIONS') {
            return ['status' => 204, 'body' => null];
        }
        if ($method !== 'POST') {
            return $this->error(405, 'Method Not Allowed');
        }

        $action = $input['action'] ?? null;
        if (!is_string($action) || $action === '') {
            return $this->error(400, 'Bad Request: Missing arguments');
        }

        // Admin actions (specs/ui/server-admin-panel.md) are a DIFFERENT
        // trust boundary -- password/token, not an identity sender_key --
        // so they're dispatched before the sender_key/whitelist checks
        // below, which don't apply to them. Still rate-limited (brute-force
        // protection on admin_login) via the same per-IP throttle.
        if ($action === 'admin_login' || $action === 'admin_get_config') {
            if (!$this->rateLimiter->checkAndRecordRequest($clientIp)) {
                return $this->error(429, 'Too Many Requests');
            }
            return $this->handleAdmin($action, $input);
        }

        $senderKey = $input['sender_key'] ?? null;
        if (!is_string($senderKey) || $senderKey === '') {
            return $this->error(400, 'Bad Request: Missing arguments');
        }

        if (!$this->inviteManager->isSenderAllowed($senderKey, $this->config['GLOBAL_ACCESS'], $this->config['WHITE_LIST'])) {
            return $this->error(403, 'Access Denied: Public key not in white-list');
        }

        // General per-IP throttle applies to every action, including
        // fetch_proof, before that action's own (stateless) handling.
        if (!$this->rateLimiter->checkAndRecordRequest($clientIp)) {
            return $this->error(429, 'Too Many Requests');
        }

        if ($action === 'fetch_proof') {
            return $this->handleFetchProof($input);
        }

        // Stricter bucket only for room-creating actions, and only checked
        // after the general throttle already passed -- avoids burning a
        // room-creation slot on a request that was going to be denied
        // anyway (Section 9 exec review carry-forward).
        if (in_array($action, ['create_invite', 'create_offer'], true)
            && !$this->rateLimiter->checkAndRecordRoomCreation($clientIp)
        ) {
            return $this->error(429, 'Too Many Requests');
        }

        // Section SR2: PoW gate on create_invite, checked BEFORE the room is
        // actually created (and before the general withLock/dispatch below)
        // -- an additional gate on top of, not a replacement for, the
        // general per-IP RateLimiter throttle already applied above. A
        // failed check here is 400 (bad/missing proof-of-work), never 429
        // (this isn't a rate-limit rejection).
        if ($action === 'create_invite') {
            $powError = $this->checkPow($input, $senderKey);
            if ($powError !== null) {
                return $powError;
            }
        }

        try {
            return $this->withLock(fn () => $this->dispatchAction($action, $input, $senderKey));
        } catch (\RuntimeException $e) {
            // Covers Storage::load() throwing on a corrupted/unreadable
            // database.json (the documented load-or-abort contract) and
            // lock-acquisition failures -- never caught-and-saved with an
            // empty state, per Storage's contract.
            return $this->error(500, 'Internal Server Error');
        }
    }

    /**
     * Section SR2: verifies create_invite's proof-of-work per
     * specs/phase5/sybil-resistance.md -- timestamp freshness, hash
     * difficulty, and anti-replay, in that order (cheapest checks first).
     * Returns an error response (already in the handle()-return shape) if
     * any check fails, or null if the PoW is valid and this request may
     * proceed to actually create the room.
     */
    private function checkPow(array $input, string $senderKey): ?array
    {
        $powTimestamp = $input['pow_timestamp'] ?? null;
        $powNonce = $input['pow_nonce'] ?? null;

        if ((!is_int($powTimestamp) && !is_float($powTimestamp)) || !is_string($powNonce) || $powNonce === '') {
            return $this->error(400, 'Bad Request: Missing or invalid proof-of-work fields');
        }

        $windowSeconds = $this->config['POW_WINDOW_SECONDS'];
        $difficultyBits = $this->config['POW_DIFFICULTY_BITS'];

        // Clock-skew/window-boundary tolerance, per the spec: reject a
        // pow_timestamp too far from the server's own clock BEFORE trusting
        // it to compute timeWindow -- otherwise a wildly stale or
        // future-dated timestamp could be used to target an arbitrary
        // (already- or not-yet-valid) window.
        if (abs(time() - $powTimestamp) > 2 * $windowSeconds) {
            return $this->error(400, 'Bad Request: proof-of-work timestamp is stale or out of tolerance');
        }

        $timeWindow = (int) floor($powTimestamp / $windowSeconds);
        $challenge = Pow::buildChallenge($timeWindow, $senderKey);

        if (!Pow::verify($challenge, $powNonce, $difficultyBits)) {
            return $this->error(400, 'Bad Request: invalid proof-of-work');
        }

        // Anti-replay MUST be the last check (and, since it MUTATES state by
        // marking the nonce spent, must only run once the request is
        // otherwise fully valid) -- an invalid PoW that also happens to
        // collide with a previously-spent triple should be rejected as
        // "invalid proof-of-work" above, not consume anti-replay bookkeeping
        // or produce a misleading "replay" error for a request that was
        // never a real replay.
        if (!$this->powNonceStore->checkAndMarkSpent((string) $timeWindow, $senderKey, $powNonce)) {
            return $this->error(400, 'Bad Request: proof-of-work already used');
        }

        return null;
    }

    private function dispatchAction(string $action, array $input, string $senderKey): array
    {
        $db = $this->storage->load();
        $this->storage->gcSessions($db);
        $this->storage->enforceMaxSessions($db, $this->config['MAX_SESSIONS']);

        switch ($action) {
            case 'create_invite':
                $result = $this->inviteManager->createInvite($db, $senderKey);
                if (!$this->storage->save($db)) {
                    return $this->error(500, 'Internal Server Error: failed to persist session');
                }
                return $this->success(['room_id' => $result['roomId'], 'invite_token' => $result['inviteToken']]);

            case 'create_offer':
                $fields = $this->requireFields($input, ['room_id', 'invite_token', 'sdp_data', 'ecdh_pubkey']);
                if ($fields === null) {
                    return $this->error(400, 'Bad Request: Missing arguments');
                }
                [$roomId, $inviteToken, $sdpData, $ecdhPubkey] = $fields;
                if (!isset($db['sessions'][$roomId])) {
                    return $this->error(404, 'Session room not found or expired');
                }
                if (!$this->inviteManager->isTokenValid($db, $roomId, $inviteToken)) {
                    return $this->error(403, 'Access Denied: invalid invite token');
                }
                $db['sessions'][$roomId]['offer'] = $sdpData;
                $db['sessions'][$roomId]['offer_ecdh_pubkey'] = $ecdhPubkey;
                if (!$this->storage->save($db)) {
                    return $this->error(500, 'Internal Server Error: failed to persist offer');
                }
                return $this->success([]);

            case 'get_offer':
                $fields = $this->requireFields($input, ['room_id', 'invite_token']);
                if ($fields === null) {
                    return $this->error(400, 'Bad Request: Missing arguments');
                }
                [$roomId, $inviteToken] = $fields;
                if (!isset($db['sessions'][$roomId])) {
                    return $this->error(404, 'Session room not found or expired');
                }
                if (!$this->inviteManager->isTokenValid($db, $roomId, $inviteToken)) {
                    return $this->error(403, 'Access Denied: invalid invite token');
                }
                $session = $db['sessions'][$roomId];
                if ($session['offer'] === null) {
                    return $this->error(404, 'Offer not published yet');
                }
                return $this->success(['offer' => $session['offer'], 'ecdh_pubkey' => $session['offer_ecdh_pubkey']]);

            case 'submit_answer':
                $fields = $this->requireFields($input, ['room_id', 'invite_token', 'sdp_data', 'ecdh_pubkey']);
                if ($fields === null) {
                    return $this->error(400, 'Bad Request: Missing arguments');
                }
                [$roomId, $inviteToken, $sdpData, $ecdhPubkey] = $fields;
                if (!isset($db['sessions'][$roomId])) {
                    return $this->error(404, 'Session room not found');
                }
                if (!$this->inviteManager->isTokenValid($db, $roomId, $inviteToken)) {
                    return $this->error(403, 'Access Denied: invalid or already-used invite token');
                }
                $db['sessions'][$roomId]['answer'] = $sdpData;
                $db['sessions'][$roomId]['answer_ecdh_pubkey'] = $ecdhPubkey;
                $this->inviteManager->markInviteUsed($db, $roomId);
                if (!$this->storage->save($db)) {
                    return $this->error(500, 'Internal Server Error: failed to persist answer');
                }
                return $this->success([]);

            case 'check_answer':
                $fields = $this->requireFields($input, ['room_id']);
                if ($fields === null) {
                    return $this->error(400, 'Bad Request: Missing arguments');
                }
                [$roomId] = $fields;
                if (!isset($db['sessions'][$roomId])) {
                    return $this->error(404, 'Room expired or closed');
                }
                $session = $db['sessions'][$roomId];
                return $this->success(['answer' => $session['answer'], 'ecdh_pubkey' => $session['answer_ecdh_pubkey']]);

            default:
                return $this->error(400, 'Unknown action');
        }
    }

    private function handleFetchProof(array $input): array
    {
        if (!($this->config['ENABLE_PROOF_PROXY'] ?? false)) {
            return $this->error(403, 'fetch_proof is disabled on this node');
        }
        $targetUrl = $input['target_url'] ?? null;
        if (!is_string($targetUrl) || $targetUrl === '') {
            return $this->error(400, 'Bad Request: Missing arguments');
        }

        $fp = $this->config['FETCH_PROOF'];
        $result = $this->fetchProofUrl($targetUrl, $fp['TIMEOUT_SECONDS'], $fp['MAX_BYTES'], $fp['MAX_REDIRECTS']);

        if (!$result['ok']) {
            // Explicit flag rather than matching on the message text -- a
            // future wording edit shouldn't silently reclassify a rejection
            // as an upstream failure or vice versa.
            return $this->error($result['reject'] ? 403 : 502, $result['error']);
        }

        return $this->success(['body' => $result['body'], 'content_type' => $result['contentType']]);
    }

    /**
     * Read-only admin panel (specs/ui/server-admin-panel.md): `admin_login`
     * verifies the password and issues a short-lived signed token;
     * `admin_get_config` requires that token and returns a hand-picked,
     * safe-to-show subset of the node's own config -- never file paths
     * (filesystem-layout disclosure), never WHITE_LIST (may contain other
     * users' identity keys), never the password hash or token secret
     * themselves. Both actions return 403 outright if the feature is
     * unconfigured (empty ADMIN_PASSWORD_HASH) -- same off-by-default
     * pattern as fetch_proof.
     */
    private function handleAdmin(string $action, array $input): array
    {
        $passwordHash = $this->config['ADMIN_PASSWORD_HASH'] ?? '';
        $tokenSecret = $this->config['ADMIN_TOKEN_SECRET'] ?? '';
        if ($passwordHash === '' || $tokenSecret === '') {
            return $this->error(403, 'Admin access is disabled on this node');
        }

        if ($action === 'admin_login') {
            $password = $input['password'] ?? null;
            if (!is_string($password) || $password === '') {
                return $this->error(400, 'Bad Request: Missing arguments');
            }
            if (!password_verify($password, $passwordHash)) {
                // Deliberately identical to the malformed/expired-token
                // message below -- neither response tells an attacker
                // which check failed.
                return $this->error(401, 'Invalid or expired admin credentials');
            }
            $ttl = $this->config['ADMIN_TOKEN_TTL_SECONDS'] ?? 900;
            $token = $this->issueAdminToken($tokenSecret, time() + $ttl);
            return $this->success(['token' => $token, 'expires_at' => time() + $ttl]);
        }

        // admin_get_config
        $token = $input['token'] ?? null;
        if (!is_string($token) || $token === '' || !$this->verifyAdminToken($tokenSecret, $token)) {
            return $this->error(401, 'Invalid or expired admin credentials');
        }

        $rl = $this->config['RATE_LIMIT'];
        $fp = $this->config['FETCH_PROOF'];
        return $this->success(['config' => [
            'session_ttl_seconds' => $this->config['SESSION_TTL_SECONDS'],
            'max_sessions' => $this->config['MAX_SESSIONS'],
            'global_access' => $this->config['GLOBAL_ACCESS'],
            'allowed_origins' => $this->config['ALLOWED_ORIGINS'],
            'request_window_seconds' => $rl['REQUEST_WINDOW_SECONDS'],
            'max_requests_per_window' => $rl['MAX_REQUESTS_PER_WINDOW'],
            'room_creation_window_seconds' => $rl['ROOM_CREATION_WINDOW_SECONDS'],
            'max_room_creations_per_window' => $rl['MAX_ROOM_CREATIONS_PER_WINDOW'],
            'enable_proof_proxy' => $this->config['ENABLE_PROOF_PROXY'] ?? false,
            'fetch_proof_timeout_seconds' => $fp['TIMEOUT_SECONDS'],
            'fetch_proof_max_bytes' => $fp['MAX_BYTES'],
        ]]);
    }

    /**
     * Self-contained signed token: base64url(json{exp}) + "." +
     * HMAC-SHA256(that payload, secret). No server-side session storage --
     * consistent with the rest of this stateless node.
     */
    private function issueAdminToken(string $secret, int $expiresAt): string
    {
        $payload = $this->base64UrlEncode(json_encode(['exp' => $expiresAt]));
        $signature = hash_hmac('sha256', $payload, $secret);
        return $payload . '.' . $signature;
    }

    private function verifyAdminToken(string $secret, string $token): bool
    {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) {
            return false;
        }
        [$payload, $signature] = $parts;
        $expectedSignature = hash_hmac('sha256', $payload, $secret);
        // Constant-time comparison -- a signature check is exactly the kind
        // of secret-dependent comparison timing attacks target.
        if (!hash_equals($expectedSignature, $signature)) {
            return false;
        }
        $decoded = json_decode($this->base64UrlDecode($payload), true);
        if (!is_array($decoded) || !isset($decoded['exp']) || !is_int($decoded['exp'])) {
            return false;
        }
        return $decoded['exp'] > time();
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $data): string
    {
        $padded = str_pad(strtr($data, '-_', '+/'), strlen($data) % 4 === 0 ? strlen($data) : strlen($data) + (4 - strlen($data) % 4), '=');
        return base64_decode($padded) ?: '';
    }

    /**
     * SSRF-guarded single-shot GET, per docs/signaling-protocol.md's
     * fetch_proof spec: http(s) only, private/reserved IPs blocked, limited
     * redirects (each hop re-validated), timeout, response size cap.
     *
     * DNS-rebinding note: resolving the host ourselves and then letting
     * curl resolve it AGAIN when connecting would leave a TOCTOU window (an
     * attacker's DNS could answer differently the second time). We close
     * that with CURLOPT_RESOLVE, which pins curl's actual connection to the
     * IP we already validated -- the IP we checked is the IP we connect to.
     *
     * IP-literal canonicalization: a literal-IP host is resolved through
     * inet_pton()/inet_ntop() rather than trusted as typed. inet_pton() is
     * the strict, authoritative parser -- it rejects decimal-integer
     * (2130706433), hex (0x7f000001), and octal-per-octet (0177.0.0.1)
     * encodings that some resolvers/libraries accept as "127.0.0.1" but
     * that filter_var()/naive string checks might not reject the same way.
     * Canonicalizing also guarantees the exact string we validated is the
     * exact string handed to CURLOPT_RESOLVE, with no room for the two to
     * disagree.
     *
     * IPv6: both A and AAAA records are resolved and validated (rejecting
     * ::1/fc00::/7/etc per the spec), but only an IPv4 address is ever
     * pinned for the actual connection -- an IPv6-only target is refused
     * rather than attempting the (differently-formatted) CURLOPT_RESOLVE
     * IPv6 syntax, an honest limitation rather than a silent gap.
     */
    private function fetchProofUrl(string $url, int $timeoutSeconds, int $maxBytes, int $maxRedirects): array
    {
        if (!function_exists('curl_init')) {
            return ['ok' => false, 'reject' => false, 'error' => 'curl extension not available on this node'];
        }

        for ($hop = 0; $hop <= $maxRedirects; $hop++) {
            $parts = parse_url($url);
            if ($parts === false || !isset($parts['scheme'], $parts['host'])
                || !in_array($parts['scheme'], ['http', 'https'], true)
            ) {
                return ['ok' => false, 'reject' => true, 'error' => 'invalid URL'];
            }
            $host = $parts['host'];
            $port = $parts['port'] ?? ($parts['scheme'] === 'https' ? 443 : 80);
            // parse_url() leaves a bracketed IPv6 host as literally "[::1]",
            // which inet_pton() rejects outright (it expects "::1") --
            // strip the brackets so IPv6 literals are actually recognized
            // and validated instead of falling through to DNS resolution.
            $hostForIpCheck = trim($host, '[]');

            $v4 = [];
            $v6 = [];
            $literal = @inet_pton($hostForIpCheck);
            if ($literal !== false) {
                $canonical = inet_ntop($literal);
                if (strpos($canonical, ':') !== false) {
                    $v6[] = $canonical;
                } else {
                    $v4[] = $canonical;
                }
            } else {
                foreach (@dns_get_record($host, DNS_A + DNS_AAAA) ?: [] as $record) {
                    if (isset($record['ip'])) {
                        $v4[] = $record['ip'];
                    }
                    if (isset($record['ipv6'])) {
                        $v6[] = $record['ipv6'];
                    }
                }
                if (!$v4 && !$v6) {
                    $resolved = gethostbyname($host);
                    if ($resolved !== $host) {
                        $v4[] = $resolved;
                    }
                }
            }
            if (!$v4 && !$v6) {
                return ['ok' => false, 'reject' => false, 'error' => 'DNS resolution failed'];
            }
            foreach (array_merge($v4, $v6) as $ip) {
                $packed = @inet_pton($ip);
                if ($packed === false
                    || !filter_var(inet_ntop($packed), FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)
                ) {
                    return ['ok' => false, 'reject' => true, 'error' => 'target resolves to a private/reserved IP'];
                }
            }
            if (!$v4) {
                return ['ok' => false, 'reject' => false, 'error' => 'IPv6-only targets are not supported'];
            }
            $pinnedIp = $v4[0];

            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RESOLVE => ["{$host}:{$port}:{$pinnedIp}"],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HEADER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_TIMEOUT => $timeoutSeconds,
                CURLOPT_RANGE => '0-' . $maxBytes,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_USERAGENT => 'SpiritSignalingNode-fetch_proof/1',
            ]);
            $raw = curl_exec($ch);
            if ($raw === false) {
                $curlError = curl_error($ch);
                curl_close($ch);
                return ['ok' => false, 'reject' => false, 'error' => "fetch failed: {$curlError}"];
            }
            $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
            $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
            curl_close($ch);

            $headers = substr($raw, 0, $headerSize);
            $body = substr($raw, $headerSize);

            if (in_array($status, [301, 302, 303, 307, 308], true)) {
                if (!preg_match('/^Location:\s*(\S+)/mi', $headers, $m)) {
                    return ['ok' => false, 'reject' => false, 'error' => 'redirect with no Location header'];
                }
                // Location is very commonly relative (absolute-path or
                // protocol-relative) in the wild; resolving it ourselves
                // means those redirects work instead of failing "invalid
                // URL" on the next loop iteration's parse_url().
                $url = $this->resolveRedirectLocation($url, trim($m[1]));
                continue;
            }

            if (strlen($body) > $maxBytes) {
                $body = substr($body, 0, $maxBytes);
            }

            return ['ok' => true, 'body' => $body, 'contentType' => $contentType];
        }

        return ['ok' => false, 'reject' => false, 'error' => 'too many redirects'];
    }

    /**
     * Resolves a Location header value against the URL it was received on.
     * Handles absolute URLs, protocol-relative ("//host/path"),
     * absolute-path ("/path"), and simple relative ("path") forms -- the
     * common cases seen in the wild. The result is re-parsed and
     * re-validated on the next loop iteration exactly like the original URL.
     */
    private function resolveRedirectLocation(string $base, string $location): string
    {
        if (preg_match('#^https?://#i', $location)) {
            return $location;
        }
        $baseParts = parse_url($base);
        if ($baseParts === false || !isset($baseParts['scheme'], $baseParts['host'])) {
            return $location;
        }
        $portPart = isset($baseParts['port']) ? ':' . $baseParts['port'] : '';
        if (str_starts_with($location, '//')) {
            return $baseParts['scheme'] . ':' . $location;
        }
        if (str_starts_with($location, '/')) {
            return $baseParts['scheme'] . '://' . $baseParts['host'] . $portPart . $location;
        }
        $basePath = $baseParts['path'] ?? '/';
        $baseDir = substr($basePath, 0, (int) strrpos($basePath, '/') + 1) ?: '/';
        return $baseParts['scheme'] . '://' . $baseParts['host'] . $portPart . $baseDir . $location;
    }

    /**
     * Returns validated string values for $fieldNames in order, or null if
     * any is missing/empty -- callers destructure only on non-null.
     */
    private function requireFields(array $input, array $fieldNames): ?array
    {
        $values = [];
        foreach ($fieldNames as $name) {
            $value = $input[$name] ?? null;
            if (!is_string($value) || $value === '') {
                return null;
            }
            $values[] = $value;
        }
        return $values;
    }

    private function success(array $extra): array
    {
        return ['status' => 200, 'body' => array_merge(['status' => 'success'], $extra)];
    }

    private function error(int $status, string $message): array
    {
        return ['status' => $status, 'body' => ['error' => $message]];
    }

    private function withLock(callable $fn)
    {
        $handle = fopen($this->config['LOCK_FILE'], 'c');
        if ($handle === false) {
            throw new \RuntimeException('Unable to open lock file');
        }
        if (!flock($handle, LOCK_EX)) {
            fclose($handle);
            throw new \RuntimeException('Unable to acquire lock');
        }
        try {
            return $fn();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
