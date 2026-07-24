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

- [x] **Stage 2 — file-transfer/мережеві параметри (2 шт.)**
  - [x] **Tests**: `client/tests/settingsRegistry.test.js` -- новий тест
        підтверджує default-значення `fileChunkSize`/
        `bufferedAmountHighThresholdBytes` збігаються з оригінальними
        константами (16KB/1MB). `client/tests/app.test.js` -- новий
        end-to-end тест ("a smaller fileChunkSize setting actually
        produces more chunks"): реально відправляє 10KB-файл через живий
        file-transfer flow з `fileChunkSize=4096` і перевіряє, що
        `offer.totalChunks` дійсно змінюється (3 замість 1 за замовчуванням)
        -- доказ, що налаштування насправді використовується, не просто
        зберігається.
  - [x] **Impl**: `client/js/settingsRegistry.js` -- `fileChunkSize`
        (default 16KB, min 4KB, max 256KB), `bufferedAmountHighThresholdBytes`
        (default 1MB, min 64KB, max 16MB), обидва в категорії `fileTransfer`
        (групуються в тому самому розділі UI, що й `fileSizeWarningBytes` із
        Stage 1). `client/js/app.js` -- `FILE_CHUNK_SIZE`/
        `BUFFERED_AMOUNT_HIGH_THRESHOLD` константи видалено, замінено на
        `getSetting(...)` у точках виклику (`sendFileChunks`,
        `splitFileIntoChunks`-виклик у file-picker обробнику).
  - [x] **Exec review**: самоперевірка -- (а) обидва default-значення
        точно збігаються з видаленими константами (16*1024, 1024*1024);
        (б) `bufferedAmountLowThreshold` (властивість каналу) і поточна
        перевірка backpressure тепер читають ОДНЕ й те саме значення
        `getSetting(...)` за виклик (не два окремі виклики, що могли б
        розійтися, якщо користувач змінить налаштування мід-transfer) --
        збережено як локальну змінну `bufferedAmountHighThreshold` на
        початку `sendFileChunks`; (в) 293/293 в app.test.js, 787/787
        повний прогін (чисто, без sandbox-flaky шуму цього разу).
- [x] **Stage RF14 — розділ дизайну (кольори, форма, типографіка)**, окрема
      картка на екрані «Сервер» поруч зі Stage 1/2's картою (за прямим
      запитом користувача: "розділ де винесені параметри дизайну, ширини
      сайту, кольорів усіх елементів, шрифтів, графіки; відображення чи
      приховування тих чи інших елементів").
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js` (15
        тестів: get/set/reset round-trip для color/length/text типів,
        валідація формату кольору, `applyDesignSettings` виставляє/знімає
        inline `:root`-властивість). `client/tests/app.test.js`, нова
        секція "Section RF14: design settings panel" (5 тестів: рендер
        усіх полів, зміна кольору застосовується одразу без
        перезавантаження, відхилення невалідного значення, per-row reset
        не чіпає інші поля, reset-all знімає всі inline-властивості).
  - [x] **Impl**: `client/js/designSettingsRegistry.js` -- новий реєстр із
        принципово іншою моделлю "default", ніж `settingsRegistry.js`:
        "типове значення" = "немає inline-перевизначення", а НЕ фіксоване
        число, бо світла/темна тема мають різні кольори за замовчуванням;
        UI читає ПОТОЧНЕ обчислене значення (`getComputedStyle`) для
        відображення, коли перевизначення немає. `applyDesignSettings()`
        викликається один раз при кожному `initApp()` (одразу після
        `initTheme`), незалежно від того, з якого екрана стартує
        користувач. `client/css/style.css` -- додано `--font-family`/
        `--font-size-base` як справжні CSS-змінні (раніше жорстко в
        `body{}`), щоб типографіку теж можна було редагувати; 10
        параметрів у 3 категоріях: Кольори (акцент, фон сторінки, фон
        карток, текст, приглушений текст, рамки), Форма (округлення
        карток, округлення кнопок/полів), Типографіка (шрифт, базовий
        розмір).
  - [x] **Exec review**: самоперевірка -- (а) реальний тест-first баг:
        `String(stored ?? parseFloat(currentRaw) || 0)` -- змішування `??`
        і `||` без дужок -- справжня синтаксична помилка ES2020 (не
        просто стиль), спіймана компіляцією тестового файлу ДО того, як
        дійшло до самих тестів; виправлено дужками; (б) `resetDesignSetting`
        коректно ВИДАЛЯЄ (`removeProperty`), а не встановлює порожній
        рядок -- підтверджено тестом, що після скидання
        `getPropertyValue` повертає `""`, а не залишкове значення; (в)
        298/298 в app.test.js, 807/807 повний прогін (чисто).

## Розділ дизайну -- що НЕ увійшло в Stage RF14 (за прямим запитом
включно, свідомо відкладено як подальші стадії)

- **Ширина сайту / сайдбара** (`1400px`/`300px`, зараз хардкоджені в
  кількох місцях `client/css/style.css`: `.app-body`, `.app-header`,
  `.conversation-toolbar`, `#app-sidebar`) -- потребує ПОПЕРЕДНЬОГО
  рефакторингу цих хардкоджених чисел у CSS-змінні (аналогічно до
  `--font-family` вище) в кількох місцях одночасно, і ретельнішого
  тестування, оскільки некоректне значення може зламати layout (сайдбар
  ширший за viewport, шапка з'їжджає відносно контенту -- та сама
  проблема, що вже виправлялась цієї сесії). Окрема стадія.
- **Показ/приховування елементів UI** ("відображення чи приховування тих
  чи інших елементів") -- потребує окремого механізму (registry записів
  типу `{key, selector, label}` + CSS-правил на кшталт
  `body[data-hide-x] .selector {display:none}` для кожного елемента) і
  явного рішення КОТРІ елементи взагалі можна ховати без ламання
  функціональності (наприклад, приховування кнопки "Надіслати" зробило б
  чат непридатним для використання) -- список кандидатів і сама механіка
  вимагають окремого продумування, не проста заміна константи.
- **Графіка** (іконки/identicon-палітра з `client/js/identicon.js`,
  emoji-палітра з `client/js/safetyNumber.js`) -- поза очевидним обсягом
  "змінна = число", власна дизайн-розмова.

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
