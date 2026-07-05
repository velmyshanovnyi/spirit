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
  library/
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

- [x] **Tests**: `client/tests/e2ee.test.js` —
  - `deriveSessionKey(privA, pubB)` на стороні A і `deriveSessionKey(privB, pubA)` на стороні B дають ключі, що взаємно розшифровують повідомлення один одного (симетричність ECDH).
  - `encryptMessage(key, plaintext)` → `decryptMessage(key, payload)` round-trip повертає вихідний текст (включно з не-ASCII).
  - Кожен виклик `encryptMessage` генерує інший IV (два шифрування того самого тексту дають різний ciphertext).
  - Підроблений/пошкоджений ciphertext → `decryptMessage` кидає помилку (GCM authentication failure), не повертає сміття мовчки.
  - Повідомлення значно більше за ліміт аргументів спред-оператора (300 000 символів) кодується/декодується без помилки.
- [x] **Impl**: `client/js/e2ee.js` — `deriveSessionKey` (ECDH shared secret → HKDF-SHA256 → AES-256-GCM `CryptoKey`), `encryptMessage`/`decryptMessage` (формат payload: `iv(12 байт) || ciphertext+tag`, base64), `bytesToBase64`/`base64ToBytes` — чанковане (0x8000 байт) кодування, уникає переповнення стека аргументів на великих повідомленнях.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-2-e2ee-iter1.md), [iter2](../reviews/mvp-section-2-e2ee-iter2.md).

## Секція 3: Signaling client (long-polling обгортка)

- [x] **Tests**: `client/tests/signalingClient.test.js` (з мокнутим `global.fetch`) —
  - `createInvite(baseUrl, senderKey)` формує коректний POST-запит (`action: "create_invite"`) і повертає `{roomId, inviteToken}` з відповіді.
  - `createOffer`, `getOffer`, `submitAnswer`, `checkAnswer` аналогічно формують правильні payload і парсять відповідь за протоколом з `signaling-protocol.md`.
  - Мережева помилка (`fetch` реджектиться), HTTP-помилка (4xx/5xx) і non-JSON тіло помилки — жодне не кидає необроблений виняток нагору, всі дають структурований `SignalingError`.
  - `pollForAnswer` зупиняється після отримання ненульової відповіді, при reject від `checkAnswer`, і при `AbortSignal.abort()` — включно з гонкою, коли abort стається під час активного запиту (abort перемагає, пізня відповідь ігнорується) — і в жодному випадку не робить зайвих запитів після зупинки.
- [x] **Impl**: `client/js/signalingClient.js` — по одній функції на кожну дію з [signaling-protocol.md](../../docs/signaling-protocol.md) (`create_invite`, `create_offer`, `get_offer`, `submit_answer`, `check_answer`), спільна `apiRequest` обгортка з `SignalingError`, `pollForAnswer` з `setTimeout`-циклом і підтримкою `AbortSignal` (прокинутий аж до `fetch`).
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-3-signaling-client-iter1.md), [iter2](../reviews/mvp-section-3-signaling-client-iter2.md).

## Секція 4: WebRTC-оркестрація

- [x] **Tests**: `client/tests/webrtc.test.js` з тонким власноручним **fake `RTCPeerConnection`** (jsdom/Node не мають реальної WebRTC-реалізації; юніт-тести перевіряють оркестрацію логіки — послідовність викликів, а не реальну мережеву поведінку) —
  - Ініціатор: `startAsInitiator()` створює `RTCPeerConnection`, `createDataChannel`, викликає `createOffer`/`setLocalDescription`, і після `icecandidate` з `candidate === null` викликає переданий callback `onLocalOfferReady(sdp)`.
  - Учасник: `startAsJoiner(offerSdp)` викликає `setRemoteDescription`, `createAnswer`, `setLocalDescription`, і після завершення ICE-збору викликає `onLocalAnswerReady(sdp)`.
  - `ondatachannel`/`channel.onopen`/`channel.onmessage` коректно прокидаються у передані callbacks.
  - Помилка в будь-якому кроці хендшейку (обох ролей) викликає `onError`, а не залишається unhandled rejection.
  - `applyRemoteAnswer(pc, answerSdp)` викликає `pc.setRemoteDescription` і завершує хендшейк ініціатора.
  - Явно **не** тестується реальне встановлення з'єднання (мережа/ICE/STUN) — це верифікується вручну в браузері (два вкладки/два клієнти) під час exec review секції, а не автоматичним тестом.
- [x] **Impl**: `client/js/webrtc.js` — тонка обгортка над `RTCPeerConnection`/`RTCDataChannel` з callback-інтерфейсом (`onLocalOfferReady`/`onLocalAnswerReady`/`onChannelOpen`/`onMessage`/`onChannelClose`/`onError`), що приймає `rtcConfig` (STUN/TURN, задається користувачем — жодних хардкоджених серверів); `applyRemoteAnswer` — окремий експорт для завершення хендшейку ініціатора з Секції 5.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-4-webrtc-iter1.md), [iter2](../reviews/mvp-section-4-webrtc-iter2.md).

## Секція 5: Мінімальний UI (wiring)

- [x] **Tests**: `client/tests/app.test.js` (environment `jsdom`, окремо від інших файлів через `// @vitest-environment jsdom`), 14 тестів —
  - Натискання "Створити акаунт" викликає `generateIdentityKeyPair` і оновлює DOM з fingerprint.
  - Натискання "Ініціювати чат"/"Приєднатися" відмовляє без акаунта (guard), інакше запускає повний ланцюжок `webrtc.startAsInitiator`/`startAsJoiner` → `signalingClient.*` (через моки модулів).
  - Отримана відповідь застосовується через `webrtc.applyRemoteAnswer` (замикає хендшейк ініціатора).
  - Надіслане повідомлення проходить через `e2ee.encryptMessage` перед `channel.send`; без активного з'єднання (`channel`/`sessionKey` відсутні) — відмова замість помилки.
  - ICE-gathering тайм-аут (окремий від тайм-ауту очікування відповіді через `AbortSignal` у `pollForAnswer`, 5 хв) — обидва не конфліктують; `onError` коректно знешкоджує ICE-таймер, щоб застаріле спрацювання не перезаписало реальну помилку.
  - Внутрішній try/catch у відв'язаних колбеках (`onLocalOfferReady`/`onLocalAnswerReady`) сурфейсить помилки сигналінгу як статус, а не unhandled rejection.
  - Re-entrancy guard: подвійний клік на "Ініціювати чат" під час активного запиту ігнорується.
  - `client/tests/identity.test.js`: round-trip `exportEcdhPublicKeyForWire`/`importEcdhPublicKeyFromWire` через `deriveBits`.
- [x] **Impl**: `client/index.html`, `client/js/app.js` — з'єднує секції 1-4, мінімальний UI (сигнальний вузол/STUN/room-id/invite-token, кнопки, чат-вивід, статус з'єднання), без CSS-фреймворків; два незалежні тайм-аути (ICE-gathering, очікування відповіді); `client/js/identity.js` доповнено `exportEcdhPublicKeyForWire`/`importEcdhPublicKeyFromWire` для передачі ECDH-ключів через сигнальний канал.
- [x] **Exec review**: 3 ітерації (гранична кількість), конвергенція — [iter1](../reviews/mvp-section-5-ui-wiring-iter1.md), [iter2](../reviews/mvp-section-5-ui-wiring-iter2.md), [iter3](../reviews/mvp-section-5-ui-wiring-iter3.md).

---

## Секція 6: Сигнальний вузол — файлове сховище і GC

- [x] **Verify** (замість PHPUnit — див. waiver вище): деплой на `spirit.kibr.com.ua` через FTP, живі HTTP-запити (`server/verify/section6_storage.php`) підтвердили `save`/`load` round-trip, `gcSessions` видаляє застарілі й лишає свіжі записи, `load()` кидає виняток на пошкодженому вмісті замість мовчазного спорожнення, версія PHP на хості ≥7.4.
- [x] **Impl**: `server/library/Storage.php` — атомарний запис через temp-file+`rename()` (замість покладання на сам лише `LOCK_EX`), `load()` розрізняє "відсутньо" (легітимно порожньо) від "пошкоджено/нечитабельно" (кидає `RuntimeException`), `json_encode`-guard у `save()`.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-6-storage-iter1.md), [iter2](../reviews/mvp-section-6-storage-iter2.md).

## Секція 7: Сигнальний вузол — invite-токени й контроль доступу

- [x] **Verify**: живі HTTP-запити на `spirit.kibr.com.ua` (`server/verify/section7_invite_manager.php`, 11 перевірок) — створення invite (roomId/token 128 біт), персистентність, валідний/невалідний/невідомий токен, одноразовість (rejection after use, персистентність прапорця на диску), whitelist-режим (global/allowed/rejected).
- [x] **Impl**: `server/library/InviteManager.php` — `createInvite`, `isTokenValid`, `markInviteUsed` (усі `hash_equals` для порівняння токенів/ключів, з явним `(string)`-кастом на елементах whitelist проти помилок конфігурації), `isSenderAllowed`.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/mvp-section-7-invite-manager-iter1.md), [iter2](../reviews/mvp-section-7-invite-manager-iter2.md). TOCTOU check-then-use під конкуренцією свідомо перенесено до Секції 10 (не виправно на цьому рівні без контролера-оркестратора).

## Секція 8: Сигнальний вузол — CORS

- [x] **Verify**: живі HTTP-запити з різних `Origin` на `spirit.kibr.com.ua` — дозволений origin отримує `Access-Control-Allow-Origin` з точним значенням + `Vary`/`Allow-Methods`/`Allow-Headers` (не `*`), недозволений — без жодного CORS-заголовка, `ALLOWED_ORIGINS = []` (same-origin режим) і відсутність `Origin` — теж без заголовків. Усі 4 сценарії підтверджено `curl -D -`.
- [x] **Impl**: `server/library/Cors.php` — `Cors::applyHeaders`, статичний метод без побічних залежностей, викликається контролером (Секція 10).
- [x] **Exec review**: 1 ітерація, конвергенція без правок коду — [iter1](../reviews/mvp-section-8-cors-iter1.md).

## Секція 9: Сигнальний вузол — rate limiting

- [ ] **Verify**: живі повторні запити — N проходять, N+1 у вікні повертає 429, вікно скидається за TTL, файл лічильника самоочищується (перевірити на реальному хостингу — важливо саме тут, бо це best-effort на shared-хостингу з можливими кількома PHP-процесами).
- [ ] **Impl**: `server/library/RateLimiter.php`.
- [ ] **Exec review**: —

## Секція 10: Сигнальний вузол — actions і `fetch_proof`

- [ ] **Verify**: живий повний happy-path (`create_invite → create_offer → get_offer → submit_answer → check_answer`) між двома реальними клієнтами (kibr/kolomedi), коди помилок (400/403/404/405/429/500) за специфікацією; `fetch_proof` — SSRF-блок приватних IP-діапазонів, ліміт розміру/timeout, вимкнено за замовчуванням.
  - **Перенесено з Секції 7 review**: check-then-use для invite-токена (`isTokenValid` → `markInviteUsed`) має бути атомарним у контролері (наприклад, `LOCK_EX` навколо всієї послідовності load→validate→markUsed→save), інакше два конкурентні `submit_answer` можуть обидва пройти валідацію до того, як токен позначиться використаним.
  - **Перенесено з Секції 7 review**: живий verify для цієї секції має включати конкурентний пробник (два паралельні запити `submit_answer` з одним токеном), що явно перевіряє "рівно один встигає" — послідовний verify-скрипт цього виявити не може.
  - **Перенесено з Секції 6 review**: контролер має дотримуватись контракту Storage "load-or-abort" — ловити `RuntimeException` від `load()` лише щоб повернути чисту `500`-відповідь за форматом специфікації, ніколи не catch-і-save з порожнім станом.
  - **Перенесено з Секції 8 review**: живий verify має перевірити реальний шлях завантаження `ALLOWED_ORIGINS` з конфігурації (не хардкоджений масив, як у verify-скрипті Секції 8), і що `OPTIONS`-запит (CORS preflight) отримує короткий `200`/`204` з `Cors::applyHeaders` **до** загального правила "405 на не-POST", а не потрапляє під нього.
- [ ] **Impl**: `server/public/index.php`, `server/library/SignalingController.php`.
- [ ] **Exec review**: —

---

## Відкрите питання — ВИРІШЕНО (явний waiver користувача)

PHP і Composer не встановлені в цьому середовищі розробки. Користувачу було explicitly запропоновано три варіанти (встановити PHP локально / відкласти секції 6-10 / писати без локальних юніт-тестів і верифікувати деплоєм); користувач обрав **третій варіант**, надавши FTP-доступ до двох реальних хостингів (див. `deploy/hosts.local.md`, не в git) саме для розробки й верифікації цієї частини.

**Це свідомий, explicit, gate-scoped waiver test-first hard gate з `CLAUDE.md`** для секцій 6-10 конкретно (не загальне послаблення дисципліни — клієнтські секції 1-5 пройшли повний test-first цикл). Записано тут згідно вимоги "Never `--no-verify` without an explicit, gate-scoped user waiver."

**Наслідки для секцій 6-10**:
- Тріплет "Tests" замінюється на "Verify" — верифікація через реальний деплой (FTP на kibr/kolomedi) і живі HTTP-запити (curl/WebFetch) до розгорнутого вузла, а не PHPUnit RED→GREEN.
- Exec review (гейт 3) лишається обов'язковим і незмінним для кожної секції.
- Commit gate лишається обов'язковим: секція комітиться лише після успішної верифікації деплоєм і конвергенції review.
- Якщо PHP+Composer стануть доступні локально пізніше — можна ретроактивно додати PHPUnit-тести без зміни вже верифікованої поведінки (не блокує зараз).
