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

## Секція RF2: панель керування (mic / camera / вийти) замість header call-controls

Поведінкові рішення (погоджено з користувачем 2026-10-02 перед кодом; це
єдине місце, де RF-серія змінює не лише розкладку):

- `#header-call-controls` і `btn-start-call` зникають. Нова панель
  `#room-controls` під сценою: `btn-toggle-mic`, `btn-toggle-camera` (ті самі
  id, круглі, inline SVG, `aria-pressed`), `btn-room-leave`. Кнопка «Чат» —
  у RF4 разом із шухлядою.
- **Авто-дзвінок власника invite** (уточнено після review iter1): тригер —
  обробник `identity-announce`, у момент, коли пер ВЕРИФІКОВАНО
  (`state.peerFingerprint` щойно встановлено) і `state.isInviteOwner &&
  state.localStream` (F6-прев'ю вже є). Перед offer-ом очікується
  `state.ownAnnouncePromise` (announcer повертає свій in-flight promise), тож
  пер ніколи не отримає offer раніше за наш announce (інакше відхилив би його
  через відсутній peerFingerprint). `state.isInviteOwner` переустановлюється
  в `initiateChatSession` ПІСЛЯ `resetActiveConnection()` (проксі-поле
  живе в peer-entry, який reset видаляє). Надсилається той самий
  `webrtc-call-offer`, що раніше робив `btn-start-call`. Лише власник → без
  glare; joiner додає свої треки у наявному обробнику offer-а.
- `startCall()` має guard на `sessionKey` і прапорець `state.callOfferSent`
  (не `localTracksAddedToPeer`): невдалий offer скидає прапорець, тож
  наступний тап повторює спробу замість «мертвого» дзвінка. Обидва прапорці
  (+ `ownAnnouncePromise`) глобальні, тому `initiateChatSession` скидає їх
  поруч із `resetActiveConnection()` — A3-шлях «нова сесія поверх живої» не
  проходить через teardown (review iter2). `autoStartOwnerCall` має guard
  по `activeConnectionId` через `await` announce-промісу.
- **Тап mic/camera без стріму** = `previewLocalMedia()` з увімкненим лише
  цим видом треку (інший — `enabled=false`); якщо канал відкритий, пер
  верифікований і offer ще не надсилався — одразу `startCall()`. Тап зі
  стрімом = toggle треку (як зараз). Кнопки завжди enabled (initial-disable
  і enable-on-open зникають; після розриву каналу — лишаються enabled, стан
  inactive).
- Residual (review iter1, F2): якщо joiner тапне mic/camera в той самий
  ~RTT, поки owner-offer у дорозі, обидві сторони в `have-local-offer`
  (glare) → `status.error`; завдяки retry-прапорцю повторний тап лікує.
  Вікно потребує тапу користувача саме в цю мить — прийнято як residual.
- **«Вийти з кімнати»** (`btn-room-leave`): спільний з logout teardown
  (`teardownMediaAndConnection()`: таймер прев'ю, close channel/pc, stop
  tracks, reset guard/overlay/safety hint, `resetActiveConnection`) БЕЗ
  скидання ідентичності, потім `initiateChatSession()` → нова кімната з
  новим посиланням (і для ефемерного, і для збереженого акаунта).
- Design-settings: order-item `headerCallControls` видаляється (3 пункти
  лишаються; i18n-ключ `designSettings.headerControlsOrder.item.headerCallControls`
  прибирається з усіх 11 локалей); visibility-setting `callControls`
  переназначається на `#room-controls` (тексти label/description оновлено).
- i18n: `room.leave` в усіх 11 локалях.

- [x] **Tests**: `app.test.js` — `#btn-start-call` відсутній, `#room-controls` містить mic/camera/leave, кнопки enabled до з'єднання; camera-тап без стріму → `getUserMedia` один раз, лише video-трек enabled, call-offer надіслано; подальший mic-тап вмикає audio без повторного `getUserMedia`; власник з прев'ю при `onChannelOpen` надсилає offer без кліку (`addLocalMediaTracks` ×1); leave → `channel.close`/`pc.close`, треки `stop`, `createInvite` вдруге, `#room-id-display` змінився; RF19 order-тест на 3 пункти; `designSettingsRegistry.test.js` — permutation із 3 ключів; локальна парність (i18n.test.js) з `room.leave` і без `item.headerCallControls`.
- [x] **Impl**: `client/index.html`, `client/css/style.css`, `client/js/app.js`, `client/js/designSettingsRegistry.js`, `client/js/advancedModeUI.js` (коментар), `client/js/i18n.js` + `locales/*.js`.
- [x] **Exec review**: iter1 — [reviews/room-first-RF2-iter1.md](../reviews/room-first-RF2-iter1.md) FAIL (announce/sessionKey race → тригер перенесено на верифікацію пера, retry-прапорець); iter2 — [reviews/room-first-RF2-iter2.md](../reviews/room-first-RF2-iter2.md) FAIL (A3-шлях не скидав прапорці, guard по connection-id); iter3 — [reviews/room-first-RF2-iter3.md](../reviews/room-first-RF2-iter3.md) PASS; жива перевірка — в iter3.

## Секція RF3: invite-картка «Поки що ви тут самі»

- `#room-invite-card` на сцені: заголовок `room.aloneTitle`, пояснення
  `room.aloneBody` (замість тексту welcome-модалки), пілюля з посиланням
  (`#room-invite-link`, текст скорочений CSS-ом), кнопка `btn-room-copy-invite`
  (той самий `copyInviteLink` + tooltip, що й `btn-invite-from-chat`). QR —
  не в цій секції.
- `renderInviteCard()`: видима, коли `state.isInviteOwner && !state.channel`
  і є room/token; викликається з `renderInviteBar` (lobby), з `onChannelOpen`
  (ховає) і з `handleConnectionTornDown` (повертає — власник знову сам);
  після leave — через lobby.
- Welcome-модалка (`#welcome-modal`, Section H1) видаляється з markup, JS
  (гейт `spirit.welcomeSeen` прибрано; прапорець у localStorage просто
  ігнорується) та i18n (`welcome.*` з усіх 11 локалей).
- [x] **Tests**: `app.test.js` — після `enterConversationLobby({ownsInvite:true})` картка видима з посиланням, що містить room/token; після відкриття каналу — `hidden`; у joiner-а (ownsInvite:false) картки нема; welcome-modal не показується на свіжому візиті.
- [x] **Impl**: markup, CSS, `renderInviteBar` → `renderInviteCard`, видалення welcome-гейту (`spirit.welcomeSeen` лишається читатись як no-op для сумісності — або прибрати з коментарем).
- [x] **Exec review**: iter1 — [reviews/room-first-RF3-iter1.md](../reviews/room-first-RF3-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

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
