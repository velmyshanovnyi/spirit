# ICE-сервери: STUN×2 + Cloudflare TURN + Open Relay (backlog P1 продовження)

Цільова конфігурація (користувач, 2026-10-03):
1. `stun:stun.l.google.com:19302`
2. `stun:stun.cloudflare.com:3478`
3. Cloudflare Realtime TURN (основний релей): `turn.cloudflare.com` —
   UDP 3478, TCP 3478, TLS 5349, UDP 443, TCP 80, TLS 443; креденшели
   короткоживучі (TTL 24 год, оновлення на половині).
4. Open Relay (metered.ca) — запасний публічний TURN: `:80`, `:443`,
   `:443?transport=tcp`, статичні `openrelayproject`/`openrelayproject`
   (публічні, без гарантій).

Поточний стан: `buildRtcConfig(stunUrl, {turnUrl,…})` тримає рівно один
STUN і один опційний TURN; екран «Вузол» має поля `stun-url` / `turn-*`;
пресет Open Relay використовує HMAC-схему `staticauth.openrelay.metered.ca`,
яка в A12 жодного разу не відповіла.

## Інваріанти

- Zero-database: серверний кеш креденшелів — ефемерний файл з TTL (як
  `ratelimit.json`), без персистентних даних користувача.
- Секрети Cloudflare (Key ID / API Token) — лише в `server/config.secrets.php`
  (gitignored), ніколи в клієнті чи репо.
- `forceTurnRelay` семантика незмінна: `iceTransportPolicy: "relay"`.
- Клієнт без доступу до сервера / без ключів на сервері працює на
  статичному списку (1, 2, 4) — graceful degradation.

## Секція I1: список ICE-серверів у клієнті (без сервера)

- `client/js/iceServers.js` (новий, чистий): `DEFAULT_STUN_URLS`,
  `OPEN_RELAY_SERVER` (`urls: ["turn:openrelay.metered.ca:80",
  "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"]`,
  статичні креденшели), `CLOUDFLARE_TURN_URLS` (6 транспортів),
  `buildIceServers({ stunUrl?, cloudflareCredential?, customTurn?, includeOpenRelay })`
  → масив записів `{ urls, username?, credential? }` у порядку: STUN-и,
  Cloudflare (якщо є `{username, credential}`), користувацький TURN (якщо
  `turnUrl` непорожній), Open Relay (якщо `includeOpenRelay`).
- `buildRtcConfig`: перший аргумент може бути масивом `iceServers` (нова
  форма) або рядком (стара — лишається, 21 наявний виклик у тестах);
  опції ті самі.
- `currentRtcConfig()` в app.js: `buildRtcConfig(buildIceServers({
  stunUrl: поле `stun-url` (додається до DEFAULT_STUN_URLS, якщо не дублює), cloudflareCredential:
  state.cloudflareTurnCredential ?? null, customTurn: поля turn-*,
  includeOpenRelay: true }), { forceTurnRelay })`. Усі 9 колсайтів
  (app ×4, deviceLinkingUI ×2, groupMesh ×2) — через `currentRtcConfig`,
  без змін.
- Пресет `turn-preset` «Open Relay»: статична пара з цільової конфігурації
  замість HMAC-схеми; `turnCredentials.js` лишається (не видаляється —
  користувацький Metered-акаунт із shared secret усе ще валідний сценарій).
- [x] **Tests**: `client/tests/iceServers.test.js` — порядок/склад масиву для 4 комбінацій (лише дефолт; +cloudflare; +custom; без Open Relay); `rtcConfig.test.js` — масив як перший аргумент проходить як є, рядок — як раніше; `app.test.js` — `currentRtcConfig()` (через startAsInitiator mock) містить 2 STUN + Open Relay + (за наявності) custom TURN; `serverConfigUI.test.js`/`app.test.js` — пресет Open Relay заповнює статичну пару (RED до impl).
- [x] **Impl**: `iceServers.js`, `webrtc.js` (перевантаження), `app.js` (`currentRtcConfig`, `state.cloudflareTurnCredential = null`), `serverConfigUI.js` (пресет; наявні label/hint пресету лишаються точними — markup/i18n без змін).
- [x] **Exec review**: iter1 — [reviews/ice-servers-I1-iter1.md](../reviews/ice-servers-I1-iter1.md). PASS; 2 spec-drift нотатки виправлено; жива перевірка (STUN ok, Open Relay — 0 кандидатів, див. A12) — в артефакті.

## Секція I2: серверний ендпойнт `get_ice_servers` (PHP)

- `server/config.secrets.php`: `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN`
  (порожні = вимкнено). `config.php`: `ICE_CREDENTIAL_TTL_SECONDS` (86400),
  `ICE_CACHE_FILE` (`data/ice_credentials.json`).
- `TurnCredentialProvider` (library): якщо ключі є — POST
  `https://rtc.live.cloudflare.com/v1/turn/keys/{KEY_ID}/credentials/generate-ice-servers`
  з `{ ttl }`, кеш у файлі до половини TTL; повертає `{ iceServers:
  [{urls, username, credential}], expiresAt }`. Без ключів / помилка
  мережі → `{ iceServers: [], expiresAt: null }` (деградація, HTTP 200).
- `index.php`: `action=get_ice_servers` (GET, rate-limited як інші).
- [ ] **Tests**: `server/verify/` PHP-тести: провайдер без ключів → порожньо; з mock-транспортом → кеш-хіт у межах half-TTL, промах після; помилка транспорту → порожньо без винятку.
- [ ] **Impl**: library + index.php + config; деплой у `spirit/` на обох хостах; секрети — поза git, вписуються вручну після отримання від користувача.
- [ ] **Exec review**: iter1.

## Секція I3: клієнт тягне креденшели й оновлює на половині TTL

- `signalingClient.js`: `getIceServers(serverUrl)`.
- app.js: при старті і в `currentRtcConfig()` якщо `expiresAt - now <
  TTL/2` → async refresh (не блокує поточне з'єднання: використовується
  наявний кеш або статичний список); результат у
  `state.cloudflareTurnCredential` + `localStorage` (`spirit.iceCredential`,
  ефемерно, з expiresAt). Помилка → лишаємо статичний список.
- [ ] **Tests**: `app.test.js` — mock `getIceServers`: перший `currentRtcConfig` без креденшелів, після resolve — Cloudflare-запис присутній; прострочення → повторний запит; помилка → без Cloudflare, без винятку.
- [ ] **Impl**: клієнт; жива перевірка на обох хостах — ICE-кандидати типу `relay` з `turn.cloudflare.com` (після вписаних секретів).
- [ ] **Exec review**: iter1.

## Порядок

I1 (без секретів) → I2 → I3 (після отримання Key ID / API Token від користувача).
