# Room-first: екран розмови як «кімната-дзвінок» (бачення C)

Джерело: макет C на полотні «Spirit UX: три бачення» (2026-10-02), обраний
користувачем. Мета: максимально простий інтерфейс для новачка —
ефемерність зі старту, без реєстрації, менше кнопок. Сторінка = кімната.

## Принципи

1. **Нічого нового в логіці з'єднання.** Це перекомпонування наявних
   елементів (F6 lobby, RF6 header call-controls, floating-video,
   invite-bar, safety-number RF10, chat-log/input, file-transfer). Жодних
   змін у WebRTC/E2EE/сигналінгу. Zero-database не зачіпається.
2. **Advanced-режим лишається як є.** Профіль/вузол/налаштування/історія/
   керування — за footer-unlock, як зараз (D2). Room-first чіпає лише
   маршрут `conversation` і глобальний header на ньому.
3. **Ефемерність зі старту** вже є (H5: свіжий візит → авто-ефемерна
   ідентичність → lobby). Room-first лише робить це видимим: «Поки що ви тут
   самі» замість порожнього чату.
4. **Один набір кнопок на екрані**: мікрофон, камера, чат, вийти. Усе інше —
   в існуючому меню-шестерні (яке на цьому маршруті стає «⋯»).
5. **Десктоп ≥ 900px**: сцена по центру, чат — права панель замість нижньої
   шухляди (той самий DOM, інша CSS-розкладка). Сайдбар контактів — лише
   для збереженого акаунта (як зараз, `renderGuestQuickActions`-гейт).

## Відповідність макет → наявний DOM

| Макет C | Наявний елемент | Що змінюється |
|---|---|---|
| «Кімната 7f3a · E2EE» (замок) | `#conversation-toolbar` → `h2` + `#connection-status` | текст = короткий room id (перші 4 символи `#room-id`, який заповнюють і ініціатор після createInvite, і joiner з invite-link; у груповій розмові чип прихований) + стан; замок зелений при відкритому каналі |
| пілюля «код A3F9 · 7C21» | `#safety-number-hint` (RF10 shared code) | компактний вигляд у toolbar; тап = розгортає повний hint як зараз |
| сцена з прев'ю | `#floating-video` (`#video-local`, `#video-remote`) | на маршруті `conversation` — док у `#room-stage` (full-width, не draggable); на інших маршрутах — як зараз (плаваюче) |
| бейдж «Ви · Тихий Лис · камера вимкнена» | `#ephemeral-identity-banner` + `updateCallButtonStates` | переїжджає на сцену |
| картка «Поки що ви тут самі» + пілюля + копіювати | `#invite-bar` / `btn-invite-from-chat` + `renderInviteBar` | картка-оверлей на сцені, доки канал не відкритий; зникає при `afterChannelOpen` |
| шухляда «Текстовий чат і файли» | `#chat-log`, `#group-chat-log`, `.chat-input-row`, `#file-transfers`, `#file-offer-banner`, `#chat-send-status` | обгортка `#room-chat-drawer` з ручкою; стани collapsed/expanded; авто-expand при вхідному повідомленні/файлі, бейдж непрочитаних на кнопці «Чат» |
| 4 круглі кнопки | `#btn-toggle-mic`, `#btn-toggle-camera` (переїжджають з header), нова `#btn-room-chat`, нова `#btn-room-leave` | `btn-start-call` зникає: перший тап по мікрофону/камері = `previewLocalMedia()` + `acquireLocalStream()` (той самий код, що зараз під btn-start-call) |
| «Вийти» (червона) | нема прямого аналога | = наявна логіка закриття сесії (`resetConnection`-шлях + `enterConversationLobby({ownsInvite:true})` з новим invite) — ефемерному користувачу дає свіжу кімнату; збереженому — повертає у lobby |

## Секція RF1: сцена й toolbar (markup + CSS, без зміни поведінки)

- `client/index.html`: усередині `[data-screen="conversation"]` з'являється
  `#room-stage` (контейнер сцени) → у нього переносяться `#floating-video`-
  тайли при вході на маршрут (JS у RF2); `#conversation-toolbar` отримує
  `#room-id-display` і замок `#room-lock` (inline SVG, `aria-label`).
- `client/css/style.css`: темна сцена (токени `--room-*` із fallback на
  `--bg`/`--card-bg` темної теми), `#room-stage` = `flex-grow:1`, тайл
  remote на всю сцену, local — picture-in-picture у кутку сцени; desktop
  ≥ 900px — двоколонка (сцена | чат).
- [x] **Tests**: `app.test.js` — на маршруті `conversation` `#room-stage` існує і містить `#video-local`/`#video-remote`; `#room-id-display` показує перші 4 символи `state.roomId` після `enterConversationLobby`; на маршруті `profile` тайли повертаються у `#floating-video` (drift-guard id-сетів оновлено).
- [x] **Impl**: markup + CSS; док/андок — наявний `applyVideoDockMode` (RF21) з дефолтом `docked` (реєстр: `docked` = options[0]); `renderRoomChip()`.
- [x] **Exec review**: iter1 — [reviews/room-first-RF1-iter1.md](../reviews/room-first-RF1-iter1.md): 2 знахідки, виправлено; iter2 — [reviews/room-first-RF1-iter2.md](../reviews/room-first-RF1-iter2.md): PASS; жива перевірка — в iter2.

## Секція RF2: панель керування (4 кнопки) замість header call-controls

- `#header-call-controls` з header прибирається; `#btn-toggle-mic`/
  `#btn-toggle-camera` переїжджають у `#room-controls` (круглі, 60px,
  inline SVG замість emoji, `aria-pressed`). Нові `#btn-room-chat`
  (toggle шухляди + бейдж `#room-chat-unread`) і `#btn-room-leave`.
- `btn-start-call` видаляється; обробники mic/camera: якщо
  `!state.localStream` → `acquireLocalStream()` (той самий шлях) з
  потрібним треком увімкненим, інший — вимкненим.
- `#btn-room-leave`: зупиняє локальні треки, закриває pc/канал через
  наявний reset-шлях, створює новий invite → `enterConversationLobby`.
- [ ] **Tests**: `app.test.js` — mic-тап без стріму викликає `getUserMedia` один раз і вмикає лише audio; camera-тап — лише video; leave скидає `state.pc/channel` і показує нову invite-картку з ІНШИМ room id; `#btn-start-call` відсутній у DOM (видалити/оновити старі асерти).
- [ ] **Impl**: markup, CSS, `app.js` обробники (переважно перейменування колсайтів), i18n-ключі `room.leave`, `room.chat`.
- [ ] **Exec review**: iter1.

## Секція RF3: invite-картка «Поки що ви тут самі»

- `#room-invite-card` на сцені: заголовок, пояснення, пілюля з
  посиланням (`#invite-link-display`, текст скорочений CSS-ом), кнопка
  копіювати (той самий обробник, що `btn-invite-from-chat`), опційно QR
  (наявний lazy `qr.js`) за тапом.
- Видима, коли `state.isInviteOwner && !channelOpen`; ховається у
  `afterChannelOpen`; знову з'являється після leave.
- Welcome-модалка (`#welcome-modal`) більше не показується: її текст
  («Анонімний, наскрізно зашифрований P2P-чат») переїжджає у картку.
- [ ] **Tests**: `app.test.js` — після `enterConversationLobby({ownsInvite:true})` картка видима з посиланням, що містить room/token; після відкриття каналу — `hidden`; у joiner-а (ownsInvite:false) картки нема; welcome-modal не показується на свіжому візиті.
- [ ] **Impl**: markup, CSS, `renderInviteBar` → `renderInviteCard`, видалення welcome-гейту (`spirit.welcomeSeen` лишається читатись як no-op для сумісності — або прибрати з коментарем).
- [ ] **Exec review**: iter1.

## Секція RF4: чат-шухляда

- `#room-chat-drawer` обгортає chat-log/input/file-елементи; стани
  `data-state="collapsed|expanded"`; ручка + кнопка «Чат»; на desktop
  ≥ 900px завжди expanded як права панель.
- Авто-expand при вхідному `chat`/`file-offer`, якщо collapsed; інакше
  лічильник `#room-chat-unread` (скидається при expand).
- Фокус у `#message-input` при expand; Escape → collapse (на mobile).
- [ ] **Tests**: `app.test.js` — вхідне повідомлення у collapsed-стані робить expand; при expanded — лічильник не росте; «Чат» toggle; `settingsPanelUnified`/drift-guard — id-сети.
- [ ] **Impl**: markup, CSS, `app.js` (handleChatMessage: один виклик `noteIncomingForDrawer()`), i18n.
- [ ] **Exec review**: iter1.

## Секція RF5: header на маршруті `conversation`

- На `conversation`: brand → лише логотип «S»; `#guest-quick-actions`
  (Створити/Увійти) → один пункт «Зберегти акаунт» у меню; `#lang-select`
  і `#theme-toggle` → у меню `#settings-menu` (як пункти); шестерня → «⋯».
  На інших маршрутах — як зараз (нічого не ламати в advanced).
- [ ] **Tests**: `app.test.js` — на `conversation` у header видимі лише логотип і «⋯»; у меню є пункти мови/теми/«Зберегти акаунт»; на `profile` header як раніше.
- [ ] **Impl**: markup (пункти меню), CSS (route-класи на `body`), `app.js` `setConversationChromeVisible` розширюється.
- [ ] **Exec review**: iter1.

## Поза скоупом (свідомо)

- Мультитайлова сцена для груп (GC3 рендерить групу в той самий екран —
  лишається текстовим; відео в групах і так нема).
- Зміна H5/F6-логіки авто-прев'ю камери (`localMediaPreviewDelayMs`).
- Будь-які зміни серверу/сигналінгу.

## Порядок

RF1 → RF2 → RF3 → RF4 → RF5. Кожна секція — повний цикл (RED → impl →
review → коміт → пуш → деплой → жива перевірка на обох хостах).
