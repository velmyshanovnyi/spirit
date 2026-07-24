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

- [x] **Stage RF15 -- ширина сторінки/сайдбара (нова категорія "Розмітка"
      у розділі дизайну)**
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js`, нова
        секція "Section RF15: layout width settings" (2 тести:
        `applyDesignSettings` виставляє `--content-max-width`/
        `--sidebar-width` у px при перевизначенні; відхилення значення
        сайдбара поза межами 200-500). `client/tests/app.test.js`, новий
        тест "Section RF15: page/sidebar width settings apply as px
        custom properties" (зміна обох полів через UI дійсно виставляє
        inline CSS-властивості на `:root`).
  - [x] **Impl**: `client/css/style.css` -- додано `--content-max-width:
        1400px`/`--sidebar-width: 300px` у `:root` (теми-незалежні, як і
        `--font-family`), замінено 4 хардкоджені входження `1400px`/
        `300px` у `.app-header`, `.app-body`, `#app-sidebar`,
        `.conversation-toolbar` на `var(...)`.
        `client/js/designSettingsRegistry.js` -- нова категорія `layout`:
        `contentMaxWidth` (800-2400px), `sidebarWidth` (200-500px).
        `client/js/i18n.js` -- ключ `design.category.layout` у всіх 11
        локалях. `client/js/app.js` -- мапа заголовків категорій у
        `renderDesignSettings()` доповнена `layout`.
  - [x] **Exec review**: самоперевірка -- (а) усі 4 реальні хардкоджені
        числа замінено (перевірено `grep -n "1400px\|: 300px\|0 300px"` --
        лишились тільки нові `:root`-оголошення й коментарі); (б)
        min/max (800-2400 / 200-500) обрані так, щоб неможливо було
        звузити сайдбар/контент до непридатного для використання стану;
        (в) 328/328 у фокусованому прогоні трьох змінених тестових файлів
        (`app.test.js`, `designSettingsRegistry.test.js`,
        `settingsRegistry.test.js`); повний `npx vitest run` двічі
        обірвався через відомий sandbox worker-crash (resource
        exhaustion, не пов'язано з кодом -- нуль реальних failed
        assertions у жодному з часткових прогонів); (г) живо перевірено
        на обох хостах (`spirit.kolo.media`, `spirit.kibr.com.ua`) --
        поля "Максимальна ширина сторінки"/"Ширина бічної панелі"
        рендеряться під заголовком "Розмітка" з коректними значеннями
        1400/300, зміна значення на kolo.media (900) миттєво
        застосувалась як inline `--content-max-width: 900px` без
        перезавантаження. Коміт `218e715`, задеплоєно на kibr/kolomedi.

- [x] **Stage RF16 -- показ/приховування елементів UI (нова категорія
      "visibility" у тому самому реєстрі дизайну)**
  - Рішення архітектури (без додаткового обговорення, деталізує вже
    описаний в попередній версії цього розділу підхід): розширити
    `DESIGN_SETTINGS`/`designSettingsRegistry.js` записами
    `{key, category:"visibility", type:"boolean", selector, label,
    description}` замість окремого нового реєстру -- за прямим запитом
    користувача "усі можливі налаштування винось в цей розділ" (один
    розділ дизайну, а не декілька паралельних UI). `getDesignSetting`/
    `setDesignSetting`/`applyDesignSettings` розширюються під тип
    `"boolean"`: default (немає запису в `localStorage`) = елемент
    видимий; `applyDesignSettings` викликає `querySelectorAll(selector)`
    і виставляє/знімає inline `style.display = "none"` (не CSS custom
    property -- ці записи не мають `cssVar`).
  - Список кандидатів (безпечні для приховування -- не ламають базовий
    функціонал чату, на відміну від, наприклад, кнопки "Надіслати"):
    `callControls` (`#header-call-controls` -- кнопки відеодзвінка в
    шапці), `sidebarSearch` (`.sidebar-search`), `sidebarFilters`
    (`.sidebar-filters` -- чипи "Усі"/"Верифіковані"/"Групи"),
    `folderTree` (`#folder-tree`), `proofsCheckBlock`
    (`#proofs-check-block`, новий wrapping-div у `client/index.html`
    навколо кнопки "Перевірити зараз" і статусу перевірки -- потрібен,
    бо раніше кнопка й статус не мали спільного контейнера).
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js`, нова
        секція "Section RF16: element visibility settings" (3 тести:
        default = visible/null, boolean set/get round-trip,
        `applyDesignSettings` виставляє/знімає `style.display` на
        елементі за `selector`); registry-shape тест розширено під
        `type: "boolean"` (без `cssVar`, з обов'язковим `selector`).
        `client/tests/app.test.js`, новий тест "Section RF16: unchecking
        a visibility checkbox hides the target element, rechecking shows
        it again" -- підтверджено RED до імплементації (3 тести впали з
        `unknown setting "folderTree"` / falsy assertion), потім GREEN.
  - [x] **Impl**: `client/js/designSettingsRegistry.js` -- 5 нових
        записів категорії `visibility` (`callControls`, `sidebarSearch`,
        `sidebarFilters`, `folderTree`, `proofsCheckBlock`);
        `getDesignSetting`/`setDesignSetting` розширено під
        `type: "boolean"` (`"1"`/`"0"` у localStorage, default null =
        видимий); `applyDesignSettings` для boolean-записів робить
        `querySelectorAll(selector)` і виставляє
        `style.display = "none"`/`""`. `client/js/app.js` --
        `renderDesignSettings` рендерить `<input type=checkbox>` для
        `type==="boolean"`, change-обробник читає `input.checked`
        замість `input.value` для цього типу; категорія `visibility`
        додана в мапу заголовків. `client/js/i18n.js` --
        `design.category.visibility` у 11 локалях (перевірено Node-
        скриптом: усі 11 різні й коректні). `client/index.html` -- нова
        wrapping-обгортка `#proofs-check-block` навколо кнопки
        "Перевірити зараз" і статусу перевірки (раніше без спільного
        контейнера).
  - [x] **Exec review**: самоперевірка -- (а) жоден із 5 обраних
        селекторів не торкається елементів, приховування яких зламало б
        базовий флоу чату (кнопка "Надіслати", поле вводу повідомлення,
        сама розмова -- свідомо НЕ додані в список кандидатів); (б)
        default (немає запису в localStorage) = видимий елемент,
        підтверджено тестом, узгоджено з семантикою "default" інших
        design-записів; (в) 332/332 у фокусованому прогоні трьох
        файлів (1 непов'язаний flaky-тест "ICE gathering timeout" впав
        у спільному прогоні через sandbox timer-race, підтверджено
        чистим в ізольованому повторному запуску -- той самий
        добре задокументований клас sandbox-шуму цієї сесії, не
        регресія від цієї зміни).

## Розділ дизайну -- "Графіка" закрито БЕЗ коду (дослідження завершено,
рішення прийняте свідомо)

Останній пункт із початкового запиту користувача ("...кольорів усіх
елементів, шрифтів, **графіки**...") був позначений як окрема
дизайн-розмова до фактичного дослідження коду. Після перевірки обох
кандидатів висновок: жоден не потребує (чи не повинен отримати) нового
UI-параметра.

- **Кольори identicon** (`client/js/identicon.js`) -- НЕ потребують
  окремого параметра. `buildIdenticonSvg` рендерить `fill="currentColor"`
  без власних кольорів; фактичний колір/фон аватара задається CSS-
  класами `.avatar`/`.shape-user`/`.shape-group`/`.shape-ghost` через
  `var(--accent)`/`var(--accent-soft)` (`client/css/style.css:1250-1299`)
  -- а `--accent` вже редагований користувачем через `accentColor` зі
  Stage RF14. Окремого "identicon-палітри" в коді не існує -- нічого
  переносити.
- **Emoji-палітра safety number** (`EMOJI_PALETTE` у
  `client/js/safetyNumber.js:39-45`) -- свідомо НЕ виноситься в
  налаштування, і це остаточне рішення, а не відкладення. `hexToEmoji`
  детерміновано перетворює байти fingerprint'а обох співрозмовників у
  ОДНАКОВУ emoji-послідовність, яку вони звіряють вголос одне з одним
  (`docs/e2ee.md`). Якби палітра була користувацькою, зміна її ОДНИМ
  учасником зробила б порівняння марним для іншого -- та сама причина,
  з якої `POW_*`/`ARGON2ID_*`/`CLOCK_SKEW_*` лишаються захардкодженими
  константами, а не UI-параметрами (див. розділ "НЕ переносити" нижче):
  це протокольна/безпекова константа, спільна для обох сторін, а не
  індивідуальна смакова настройка.

Цим розділ "Графіка" -- і весь бектрог розділу дизайну зі спеки RF13 --
вважається закритим.

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
