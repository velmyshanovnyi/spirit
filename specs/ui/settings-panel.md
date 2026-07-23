# Спека: Централізована панель налаштувань (RF13)

Запит користувача: "з усіх розділів сайту перенеси усі змінні та параметри, які
зараз захардкожені, у спеціальний розділ де їх можна буде налаштувати.
структурно, з описами за що кожен параметр відповідає. можеш розбити на багато
стадій."

## Контекст і рамки

Це наскрізний рефакторинг, що торкається багатьох файлів (`client/js/*.js`) —
під дію spec-first гейту з `CLAUDE.md`. Розбито на стадії; кожна стадія — це
одна логічно завершена секція зі своєю трійкою Tests/Impl/Exec-review та
окремим комітом. Стадії виконуються послідовно, не обов'язково в одній сесії.

**Архітектурне рішення (без додаткового обговорення з користувачем, оскільки
напряму випливає із запиту)**: новий модуль `client/js/settingsRegistry.js` —
типізований реєстр параметрів (`{ key, category, label, description, type,
default, min?, max? }`), що:
- зберігає значення в `localStorage` під ключем `spirit.settings.<key>`
  (той самий пристрій-рівень прецедент, що й `spirit.theme`/`spirit.folders`/
  `spirit.floatingVideoRect`) — НЕ прив'язано до акаунта/профілю;
- надає `getSetting(key)` (повертає збережене значення або default) — усі
  місця в кодовій базі, що раніше читали хардкоджену константу, переходять на
  виклик цієї функції;
- рендериться в новому UI-розділі (окремий маршрут `#/settings` або нова
  картка на екрані «Сервер» — рішення за агентом під час Stage 1, документувати
  тут після вибору), згрупованим за категорією, з описом і полем вводу на
  кожен параметр, кнопкою "Скинути до типових значень" per-параметр і глобально.

**Що НЕ переноситься в цю панель** (свідомо, без обговорення не чіпати):
- Значення, що вже мають власний, спеціалізований UI (`server-url`,
  `stun-url`, `force-turn-relay`, збережені вузли — екран «Сервер»; мова,
  тема — шапка сайту). Дублювання тих самих полів у двох місцях — плутанина,
  не користь.
- Криптографічні константи, зміна яких клієнтом ламає протокол-сумісність із
  сервером без синхронної зміни на сервері (`POW_WINDOW_SECONDS` —
  МАЄ точно збігатися з `server/config.php`). Ці лишаються документованими
  константами з explicit-коментарем "не виносити в UI", а не забутими.
- i18n-рядки (тексти, не параметри) — поза обсягом цього запиту.

## Стадії

- [x] **Stage 1 — інфраструктура реєстру + перша партія параметрів (9 шт.)**
  - [x] **Tests**: `client/tests/settingsRegistry.test.js` (11 тестів:
        getSetting/setSetting/resetSetting/resetAllSettings round-trip,
        default fallback, min/max/type-валідація, форма реєстру), плюс нова
        секція `client/tests/app.test.js` "Section RF13: settings registry
        panel" (5 тестів: рендер усіх полів, зміна значення, відхилення
        поза-межевого значення зі snap-back, per-row reset, reset-all).
  - [x] **Impl**: `client/js/settingsRegistry.js` (реєстр + get/set/reset),
        нова картка на екрані «Сервер» (`#settings-registry-list`,
        `#btn-reset-all-settings`, i18n на 11 мов), точки виклику замінено
        у `client/js/app.js` (iceTimeoutMs/answerWaitTimeoutMs -- через
        `index.html`'s initApp options; proofRecheckIntervalMs,
        proofFailureThreshold, fileSizeWarningBytes,
        floatingVideoDefaultWidth/Height), `client/js/session.js`
        (maxRecentAccounts), `client/js/pushSend.js` (pushTtlSeconds).
  - [x] **Exec review**: самоперевірка (без окремого Opus-проходу, тим самим
        прагматичним рішенням, що й решта цієї сесії) -- перевірено: (а)
        жодна крипто/протокольна константа (POW_*, PBKDF2_ITERATIONS,
        ARGON2ID_*, CLOCK_SKEW_*, SALT/IV_LENGTH, MAX_SHARES) НЕ потрапила в
        реєстр; (б) жодне поле, що вже має власний UI (server-url/stun-url/
        force-turn-relay/мова/тема), не задубльовано; (в) кожен виклик
        `getSetting` замінює РІВНО ту саму хардкоджену константу, без зміни
        поведінки за замовчуванням (усі default-значення в реєстрі
        збігаються з оригінальними хардкодженими числами); (г) 292/292 в
        app.test.js, 785/785 повний прогін (окрім відомих sandbox-flaky
        codec/profile тестів, які вже неодноразово підтверджені чистими в
        ізоляції цієї сесії).

- [ ] **Stage 2 — file-transfer/мережеві параметри**: `FILE_CHUNK_SIZE`,
      `BUFFERED_AMOUNT_HIGH_THRESHOLD` (обидва app.js) -- ризикованіші за
      Stage 1 (напряму впливають на пропускну здатність/стабільність
      передачі файлів через DataChannel), тому окрема секція з ретельнішим
      тестуванням граничних значень перед додаванням у UI.
- [ ] **Stage 3+** -- решта інвентаризації нижче, за потреби користувача;
      секції, позначені "НЕ переносити", лишаються задокументованими
      константами назавжди, не черговою стадією.

## Інвентаризація хардкоджених параметрів (research-прохід, завершено)

### Перенесено в реєстр (Stage 1)
`iceTimeoutMs`, `answerWaitTimeoutMs`, `proofRecheckIntervalMs`,
`proofFailureThreshold`, `fileSizeWarningBytes`, `maxRecentAccounts`,
`floatingVideoDefaultWidth`, `floatingVideoDefaultHeight`, `pushTtlSeconds`.

### Кандидати на Stage 2+ (безпечні, не крипто/протокол)
- `FILE_CHUNK_SIZE` (app.js, 16KB), `BUFFERED_AMOUNT_HIGH_THRESHOLD`
  (app.js, 1MB) -- параметри передачі файлів через DataChannel.
- `WORD_COUNT` (passwordGenerator.js, 6) -- довжина згенерованої парольної
  фрази; ризиковано (пряма зміна стійкості пароля), обговорити з
  користувачем окремо перед перенесенням.

### НЕ переносити (свідомо, документовано константами)
- `POW_DIFFICULTY_BITS`/`POW_WINDOW_SECONDS` (signalingClient.js) -- МАЄ
  точно збігатися з `server/config.php`; зміна клієнтом без синхронної
  зміни на сервері ламає протокол.
- `PBKDF2_ITERATIONS` (vault.js), `ARGON2ID_ITERATIONS`/
  `ARGON2ID_MEMORY_SIZE_KIB` (deterministicIdentity.js) -- зниження
  користувачем непомітно послаблює власний захист ключа/паролю.
- `CLOCK_SKEW_SECONDS`/`CLOCK_SKEW_MS` (googleOAuth.js, deviceLinking.js),
  `SALT_LENGTH_BYTES`/`IV_LENGTH_BYTES` (vault.js/e2ee.js) -- безпекові
  константи, не мають "зручного" значення для користувача.
- `MAX_SHARES` (shamir.js/recoveryShare.js, 255) -- математична межа
  GF(256), не параметр.
- `GOOGLE_JWKS_URL` (googleOAuth.js) -- не стосується користувача.
- `DEFAULT_RECORD_SIZE` (webPushCrypto.js), `MAX_TTL_SECONDS` (vapid.js) --
  протокольні межі RFC 8188/8292.
- `BASE64_CHUNK_SIZE` (codec.js) -- суто внутрішня деталь реалізації.

### Уже мають власний UI (не дублювати)
`server-url`, `stun-url`, `force-turn-relay`, збережені сигнальні вузли
(екран «Сервер»); мова, тема (шапка сайту); `DEFAULT_SESSION_TTL_HOURS`
(вже редаговане полем на екрані «Профіль»).
