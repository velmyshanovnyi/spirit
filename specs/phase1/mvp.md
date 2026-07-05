# Спека: Фаза 1 — MVP

Реалізація базового P2P-чату за архітектурою з `docs/`: генерація identity/ECDH ключів, переосмислений сигнальний вузол (invite-токени, CORS, rate-limiting), WebRTC-з'єднання, обов'язковий E2EE.

Джерела істини: [architecture.md](../../docs/architecture.md), [signaling-protocol.md](../../docs/signaling-protocol.md), [e2ee.md](../../docs/e2ee.md).

## Середовище виконання (перевірено емпірично)

- Node.js v24.14.1, npm 11.11.0 — **доступні**.
- PHP, Composer, Docker — **недоступні** в поточному середовищі розробки.

**Наслідок для послідовності секцій**: клієнтський код (JS) можна писати test-first одразу (Node виконує тести локально, включно з `crypto.subtle` — глобальний Web Crypto є в Node 19+). PHP-секції (сигнальний вузол) заблоковані для test-first циклу (RED→GREEN) доти, доки не буде вирішено питання тулінгу — див. "Відкрите питання" в кінці файлу. Тому PHP-секції йдуть останніми і не починаються без окремого підтвердження.

## Структура репозиторію (пропозиція)

```
client/
  index.html
  js/
    identity.js       # Секція 1
    e2ee.js            # Секція 2
    signalingClient.js # Секція 3
    webrtc.js          # Секція 4
    app.js             # Секція 5 (UI wiring)
  tests/
    identity.test.js
    e2ee.test.js
    signalingClient.test.js
    webrtc.test.js
package.json
vitest.config.js

server/
  public/index.php      # Секція 6 (entrypoint)
  src/
    Storage.php
    InviteManager.php
    Cors.php
    RateLimiter.php
    SignalingController.php
  config.php
  tests/
    StorageTest.php
    InviteManagerTest.php
    CorsTest.php
    RateLimiterTest.php
    SignalingControllerTest.php
composer.json
phpunit.xml
```

Тестовий раннер для клієнта — **Vitest** (нативний ESM, вбудований `expect`, підтримка запуску в environment `node`, де глобальний `crypto.subtle` уже є — без потреби в jsdom-полiфілах для крипто-тестів; jsdom підключається лише для секції 5, UI-wiring).

---

## Секція 1: Identity та ECDH keygen (клієнт)

- [x] **Tests**: `client/tests/identity.test.js` —
  - `generateIdentityKeyPair()` повертає ECDSA P-256 keypair (`privateKey.algorithm.name === "ECDSA"`, `namedCurve === "P-256"`).
  - `generateEcdhKeyPair()` повертає ECDH P-256 keypair.
  - `exportPrivateKeyRaw(keyPair)` → `importPrivateKeyRaw(bytes)` round-trip відновлює ключ, здатний підписувати/перевіряти той самий контент; ECDH-гілка окремо перевірена через збіг `deriveBits`.
  - `fingerprint(publicKey)` детермінований (однаковий вхід → однаковий вихід), різні ключі → різні fingerprint, довжина дайджесту 64 hex-символи.
- [x] **Impl**: `client/js/identity.js` — `generateIdentityKeyPair`, `generateEcdhKeyPair`, `exportPrivateKeyRaw`, `importPrivateKeyRaw` (з `extractable = false` за замовчуванням), `fingerprint` (SHA-256 SPKI, hex).
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-1-identity-ecdh-keygen-iter1.md), [iter2](../reviews/mvp-section-1-identity-ecdh-keygen-iter2.md).

## Секція 2: E2EE (ECDH → HKDF → AES-GCM)

- [ ] **Tests**: `client/tests/e2ee.test.js` —
  - `deriveSessionKey(privA, pubB)` на стороні A і `deriveSessionKey(privB, pubA)` на стороні B дають ключі, що взаємно розшифровують повідомлення один одного (симетричність ECDH).
  - `encryptMessage(key, plaintext)` → `decryptMessage(key, payload)` round-trip повертає вихідний текст.
  - Кожен виклик `encryptMessage` генерує інший IV (два шифрування того самого тексту дають різний ciphertext).
  - Підроблений/пошкоджений ciphertext → `decryptMessage` кидає помилку (GCM authentication failure), не повертає сміття мовчки.
- [ ] **Impl**: `client/js/e2ee.js` — `deriveSessionKey` (ECDH shared secret → HKDF-SHA256 → AES-256-GCM `CryptoKey`), `encryptMessage`/`decryptMessage` (формат payload: `iv(12 байт) || ciphertext+tag`, base64 для передачі в DataChannel).
- [ ] **Exec review**: —

## Секція 3: Signaling client (long-polling обгортка)

- [ ] **Tests**: `client/tests/signalingClient.test.js` (з мокнутим `global.fetch`) —
  - `createInvite(baseUrl, senderKey)` формує коректний POST-запит (`action: "create_invite"`) і повертає `{roomId, inviteToken}` з відповіді.
  - `createOffer`, `getOffer`, `submitAnswer`, `checkAnswer` аналогічно формують правильні payload і парсять відповідь за протоколом з `signaling-protocol.md`.
  - Мережева помилка (`fetch` реджектиться) чи HTTP-помилка (4xx/5xx) не кидає необроблений виняток нагору — повертає структуровану помилку, яку викликач може обробити.
  - `pollForAnswer(baseUrl, senderKey, roomId, {intervalMs, timeoutMs})` зупиняється після отримання ненульової відповіді і не робить зайвих запитів після зупинки.
- [ ] **Impl**: `client/js/signalingClient.js` — по одній функції на кожну дію з [signaling-protocol.md](../../docs/signaling-protocol.md) (`create_invite`, `create_offer`, `get_offer`, `submit_answer`, `check_answer`), спільна `apiRequest` обгортка, `pollForAnswer` з `clearInterval`/`AbortController` для зупинки.
- [ ] **Exec review**: —

## Секція 4: WebRTC-оркестрація

- [ ] **Tests**: `client/tests/webrtc.test.js` з тонким власноручним **fake `RTCPeerConnection`** (jsdom/Node не мають реальної WebRTC-реалізації; юніт-тести перевіряють оркестрацію логіки — послідовність викликів, а не реальну мережеву поведінку) —
  - Ініціатор: `startAsInitiator()` створює `RTCPeerConnection`, `createDataChannel`, викликає `createOffer`/`setLocalDescription`, і після `icecandidate` з `candidate === null` викликає переданий callback `onLocalOfferReady(sdp)`.
  - Учасник: `startAsJoiner(offerSdp)` викликає `setRemoteDescription`, `createAnswer`, `setLocalDescription`, і після завершення ICE-збору викликає `onLocalAnswerReady(sdp)`.
  - `ondatachannel`/`channel.onopen`/`channel.onmessage` коректно прокидаються у передані callbacks.
  - Явно **не** тестується реальне встановлення з'єднання (мережа/ICE/STUN) — це верифікується вручну в браузері (два вкладки/два клієнти) під час exec review секції, а не автоматичним тестом.
- [ ] **Impl**: `client/js/webrtc.js` — тонка обгортка над `RTCPeerConnection`/`RTCDataChannel` з callback-інтерфейсом, що приймає `rtcConfig` (STUN/TURN, задається користувачем — жодних хардкоджених серверів).
- [ ] **Exec review**: —

## Секція 5: Мінімальний UI (wiring)

- [ ] **Tests**: `client/tests/app.test.js` (environment `jsdom`, окремо від інших файлів через `// @vitest-environment jsdom`) —
  - Натискання "Створити акаунт" викликає `generateIdentityKeyPair` і оновлює DOM з fingerprint.
  - Натискання "Ініціювати чат" викликає ланцюжок `webrtc.startAsInitiator` → `signalingClient.createInvite`/`createOffer` (перевіряється через моки модулів, не реальні мережеві виклики).
  - Надіслане в полі вводу повідомлення проходить через `e2ee.encryptMessage` перед відправкою в DataChannel (перевіряється, що сирий plaintext ніколи не потрапляє напряму в `channel.send`).
- [ ] **Impl**: `client/index.html`, `client/js/app.js` — з'єднує секції 1-4, мінімальний UI (текстове поле сигнального вузла/STUN, кнопки, чат-вивід), без CSS-фреймворків.
- [ ] **Exec review**: —

---

## Секція 6: Сигнальний вузол — файлове сховище і GC ⚠️ ЗАБЛОКОВАНО

- [ ] **Tests**: `server/tests/StorageTest.php` (PHPUnit) — `save_db`/`load_db` round-trip, `gc_sessions` видаляє записи старші за TTL і залишає свіжі, конкурентний запис не губить дані (симуляція `LOCK_EX`).
- [ ] **Impl**: `server/src/Storage.php`.
- [ ] **Exec review**: —

*Не починати без PHP+Composer у середовищі виконання (див. "Відкрите питання").*

## Секція 7: Сигнальний вузол — invite-токени й контроль доступу ⚠️ ЗАБЛОКОВАНО

- [ ] **Tests**: `server/tests/InviteManagerTest.php` — токен одноразовий (другий `submit_answer` тим самим токеном відхиляється), TTL-протермінований токен відхиляється, whitelist-режим (опційний) відхиляє непрописані ключі.
- [ ] **Impl**: `server/src/InviteManager.php`.
- [ ] **Exec review**: —

## Секція 8: Сигнальний вузол — CORS ⚠️ ЗАБЛОКОВАНО

- [ ] **Tests**: `server/tests/CorsTest.php` — дозволений origin отримує `Access-Control-Allow-Origin` з точним значенням (не `*`), недозволений — без заголовка, `ALLOWED_ORIGINS = []` (same-origin режим) — без заголовка взагалі.
- [ ] **Impl**: `server/src/Cors.php`.
- [ ] **Exec review**: —

## Секція 9: Сигнальний вузол — rate limiting ⚠️ ЗАБЛОКОВАНО

- [ ] **Tests**: `server/tests/RateLimiterTest.php` — N запитів проходять, N+1 у вікні повертає 429, вікно скидається за TTL, файл лічильника самоочищується.
- [ ] **Impl**: `server/src/RateLimiter.php`.
- [ ] **Exec review**: —

## Секція 10: Сигнальний вузол — actions і `fetch_proof` ⚠️ ЗАБЛОКОВАНО

- [ ] **Tests**: `server/tests/SignalingControllerTest.php` — повний happy-path (`create_invite → create_offer → get_offer → submit_answer → check_answer`), коди помилок (400/403/404/405/429/500) за специфікацією; `fetch_proof` — SSRF-блок приватних IP-діапазонів, ліміт розміру/timeout, вимкнено за замовчуванням.
- [ ] **Impl**: `server/public/index.php`, `server/src/SignalingController.php`.
- [ ] **Exec review**: —

---

## Відкрите питання (потребує відповіді перед продовженням до Секції 6+)

PHP і Composer не встановлені в цьому середовищі — test-first hard gate не може бути дотриманий для секцій 6-10 (немає способу отримати RED, а потім GREEN, локально). Варіанти:
1. Встановити PHP CLI + Composer локально в цьому середовищі — тоді секції 6-10 йдуть за тим самим протоколом, що й клієнтські.
2. Відкласти секції 6-10 до окремої сесії/машини з PHP, а зараз довести до кінця лише клієнтські секції 1-5 (без реального сигнального вузла клієнт не можна перевірити end-to-end у браузері, але кожна секція самодостатньо тестована і review-able).
3. Написати PHP-код без локального запуску тестів, зафіксувавши `HALT`-сентінел на цих секціях (`specs/phase1/mvp.halt.md`) до моменту, коли тести таки можна буде виконати — technically дозволено дисципліною, але **порушує дух test-first gate** (тести пишуться, але ніколи не бачать RED) і не рекомендується.

Рекомендація: варіант 1, якщо є змога встановити PHP+Composer; інакше варіант 2.
