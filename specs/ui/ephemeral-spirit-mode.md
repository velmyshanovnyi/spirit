# Спека: Редизайн екрана «Акаунт» + анонімний режим «духів» (Ephemeral Spirit Mode)

Дві пов'язані зміни: (1) екран «Акаунт» стає чіткою розвилкою «створити профіль» **vs** «увійти», перемикання — явним тумблером-посиланням, а не двома блоками одночасно; (2) «Швидкий чат (ефемерний)» — окрема, менш акцентована третя опція, яка тепер повністю автоматична: клік ініціатора → авто-нік, авто-створення кімнати, авто-перехід у чат; перехід за invite-посиланням — так само нуль кліків для приєднання (генерація ідентичності + приєднання відбуваються самі, без участі користувача).

## Рішення (узгоджено з користувачем)

1. Екран «Акаунт»: два взаємовиключні режими (create/login), перемикаються посиланням-тумблером знизу кожного блоку. За замовчуванням — режим «Увійти», якщо є збережені профілі (наявна поведінка Секції 17), інакше — «Створити профіль». «Швидкий чат (ефемерний)» — окреме, візуально другорядне посилання під обома режимами (не кнопка нарівні з «Створити профіль»).
2. Анонімний нік — прикметник + істота з фіксованого списку (напр. «Тихий Привид», «Спритна Тінь»), обирається випадково при кожному ефемерному запуску.
3. Кнопка запрошення в ефемерному режимі розмови копіює invite-посилання в буфер — той самий механізм, що вже є на екрані «Кімната» (`btn-copy-invite`), лише винесений у видиму частину екрана «Розмова».
4. Приєднання за invite-посиланням — повністю автоматичне: жодних кліків від того, хто переходить за посиланням (генерація identity+нік+приєднання до кімнати стартують одразу при завантаженні сторінки).

## Секція F1: Генератор анонімного ніку

- [x] **Tests**: `client/tests/anonymousNickname.test.js` (новий файл) — `generateAnonymousNickname()` повертає рядок формату `"<Прикметник> <Істота>"` з фіксованих списків; виклик багато разів (напр. 50) дає принаймні кілька різних значень (не завжди одне й те саме — базова перевірка випадковості, не крипто-якості).
- [x] **Impl**: `client/js/anonymousNickname.js` — прості масиви прикметників/істот (дух-тематика: Привид, Тінь, Дух, Примара, Silhouette тощо), `crypto.getRandomValues`-базований вибір (не `Math.random`, для узгодженості з рештою кодової бази, хоч тут немає криптографічних вимог — просто стиль проєкту).
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F1-F5-iter1.md](../reviews/ephemeral-spirit-mode-F1-F5-iter1.md). Реальних знахідок для Секції F1 немає.

## Секція F2: Екран «Акаунт» — create/login тумблер, ефемерний чат другорядним посиланням

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — за замовчуванням без збережених профілів показується режим створення, режим логіну прихований; клік на тумблер-посилання «Увійти в наявний акаунт» перемикає на режим логіну (і навпаки, «Створити новий акаунт» — назад); наявність збережених профілів і далі визначає початковий режим (регресія Секції 17); посилання «Швидкий анонімний чат» присутнє в обох режимах.
- [x] **Impl** (назви елементів відрізняються від чернетки — узгоджено з фактичним UI під час імплементації): `client/index.html` (`#account-create-mode`/наявний `#account-login-block` — взаємовиключні через `hidden`, тумблери-кнопки `#link-switch-to-login`/`#link-switch-to-create` (стилізовані як посилання класом `.btn-link`, НЕ `<a href="#">` — конфліктувало б із hash-роутером), окрема кнопка `#btn-quick-chat` замість `#link-quick-chat`), `client/js/app.js` (видимість `#account-create-mode`/`#account-login-block` керується в `refreshProfileSelector()` + обробники тумблерів), `client/js/i18n.js` (`account.switchToLogin`, `account.switchToCreate`, `ephemeral.youAre` × 11 локалей). Стара кнопка `btn-generate` залишена в коді за guard-перевіркою `if (el("btn-generate"))` — використовується лише як setup-boilerplate у ~37 наявних тестах непов'язаних фіч, у реальному `index.html` відсутня.
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F1-F5-iter1.md](../reviews/ephemeral-spirit-mode-F1-F5-iter1.md). Реальних знахідок для Секції F2 немає.

## Секція F3: Авто-ініціація ефемерного чату (сторона того, хто починає)

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — клік `#btn-quick-chat` без жодних інших дій користувача: генерує identity, генерує й зберігає анонімний нік (`state.nickname`), створює invite (`createInvite`), запускає `startInitiatorSession`, і після відкриття каналу автоматично переходить на екран «Розмова» (той самий патерн `afterChannelOpen`, що й наявний `btn-initiate`); повторний клік під час виконання ігнорується (re-entrancy guard).
- [x] **Impl**: `client/js/app.js` — виділено спільну логіку `btn-initiate` в `initiateChatSession()`, викликану і кнопкою «Ініціювати чат» (наявна поведінка без змін), і новим обробником `#btn-quick-chat` (перед викликом додатково генерує identity+нік).
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F1-F5-iter1.md](../reviews/ephemeral-spirit-mode-F1-F5-iter1.md). Реальних знахідок для Секції F3 немає.

## Секція F4: Нуль-клікове приєднання за invite-посиланням

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — `initApp` із заповненими `?room=&token=` у `locationSearch`: одразу (без жодного кліку) генерує ephemeral identity + анонімний нік, викликає `startJoinerSession` з параметрами з URL, переходить на «Розмова» після відкриття каналу; `#btn-quick-chat` дизейблиться на час auto-join, повторний клік не запускає конкуруючу сесію (exec review, п.1).
- [x] **Impl**: `client/js/app.js` — у гілці `if (cameFromInviteLink)` fire-and-forget IIFE (генерація identity+нік → `startJoinerSession`); захисний `if (state.senderKey) return;` на випадок майбутнього авто-відновлення сесії (exec review, п.2); дизейблить `#btn-quick-chat` на час виконання (exec review, п.1).
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F1-F5-iter1.md](../reviews/ephemeral-spirit-mode-F1-F5-iter1.md). 1 знахідка середньої критичності (гонка між F4 auto-join і ручним кліком `btn-quick-chat`, що затирала спільний стан) — виправлено.

## Секція F5: Відображення тимчасового ніку + кнопка запрошення на екрані «Розмова»

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — у ефемерному режимі (`state.nickname` задано, немає `vaultKey`) на екрані «Розмова» показується нік і кнопка запрошення; кнопка копіює invite-посилання (той самий текст/поведінка, що й `btn-copy-invite`); у профільному режимі (є `vaultKey`, нік теж задано — реально б'є по потрібній гілці, виправлено в exec review, п.3) блок прихований.
- [x] **Impl**: `client/index.html` (`#ephemeral-identity-banner` на екрані `conversation`, кнопка `#btn-invite-from-chat`), `client/js/app.js` (`renderEphemeralBanner()`, виклик з трьох `afterChannelOpen`-точок і з `onScreenChange`; `copyInviteLink()` виділено зі спільного з `btn-copy-invite`).
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F1-F5-iter1.md](../reviews/ephemeral-spirit-mode-F1-F5-iter1.md). 1 знахідка якості тесту (не бив по потрібній гілці) — виправлено.

## Секція F6: Миттєве лобі розмови — invite-бар + прев'ю камери/мікрофона до приєднання співрозмовника

Записано за прямим запитом користувача (2026-07-17): клік на «Швидкий чат (ефемерний)» має одразу відкривати `#/conversation` (не окремий екран «Кімната»), з видимою кнопкою копіювання запрошення зверху, і можливістю бачити власне відео з камери й тестувати мікрофон ще ДО приєднання співрозмовника — однаково для ініціатора й приєднувача, для ефемерних і звичайних (профільних) користувачів. Формальний AskUserQuestion-крок spec-first пропущено, оскільки повідомлення користувача вже було вичерпною специфікацією; секція документується постфактум для Claude Country continuity.

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — новий describe "instant conversation lobby: local camera/mic preview while waiting (Section F6)" (5 тестів: миттєвий getUserMedia+прев'ю на quick-chat без очікування каналу; те саме для ручного `btn-join`, з прихованим invite-баром для приєднувача; повторне використання вже отриманого stream при реальному старті дзвінка — `getUserMedia`/`addLocalMediaTracks` викликаються рівно по одному разу; graceful-деградація при відмові в дозволі; конкурентний подвійний виклик `previewLocalMedia()` не породжує другий `getUserMedia`-запит — exec review iter1 знахідка). Оновлено існуючі тести в "btn-quick-chat", "ephemeral identity banner", "zero-click invite-link auto-join": очікують `conversation` замість `room`, перевіряють окремий `#invite-bar` замість кнопки всередині ephemeral-банера. Глобальний дефолтний мок `navigator.mediaDevices.getUserMedia` (проміс, що ніколи не резолвиться) додано в top-level `beforeEach`, щоб новий fire-and-forget прев'ю-виклик не ламав сотні непов'язаних тестів. 148/148 у `app.test.js`, 431/431 по проєкту.
- [x] **Impl**: `client/js/app.js` — `previewLocalMedia()` (лише `getUserMedia`+прев'ю, без торкання `state.pc`; кешує in-flight proмiс через `state.localMediaPreviewPromise` для конкурентного захисту); `acquireLocalStream()` перероблено на `previewLocalMedia()` + одноразовий `addLocalMediaTracks` через `state.localTracksAddedToPeer`; нова `renderInviteBar()` + `state.isInviteOwner`; спільний `enterConversationLobby({ownsInvite})` викликається з `initiateChatSession()` (ownsInvite:true, одразу після створення invite, замість старого `router.navigate("room")`), з `btn-join` та з F4 zero-click auto-join IIFE (обидва ownsInvite:false, одразу після `startJoinerSession`, а не лише в `afterChannelOpen`). `client/index.html` — `#ephemeral-identity-banner` розділено: кнопка запрошення виїхала в окремий, завжди доступний (не лише ефемерний) `#invite-bar`.
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F6-iter1.md](../reviews/ephemeral-spirit-mode-F6-iter1.md). 1 знахідка (PLAUSIBLE, concurrency: подвійний швидкий клік міг запустити другий конкурентний `getUserMedia` до завершення першого, "осиротивши" перший stream) — виправлено кешуванням in-flight promise. iter2 — [reviews/ephemeral-spirit-mode-F6-iter2.md](../reviews/ephemeral-spirit-mode-F6-iter2.md), збіжність, нуль нових знахідок.

### F6-followup: живою перевіркою користувача виявлено — повідомлення не надсилалось (Enter і кнопка)

Живе тестування користувачем на `spirit.kolo.media` (2026-07-17, скріншот) виявило: `#connection-status` (ціль усіх `setStatus(...)`) переїхав на екран `conversation` разом із F6, але Enter ніколи не надсилав повідомлення (лише клік по кнопці — давня, окрема прогалина, помічена під час розслідування). Користувач бачив повністю "живий" екран розмови без жодного індикатора "ще ніхто не приєднався".

- [x] **Tests**: `client/tests/app.test.js` — новий тест перевіряє дзеркалення guard-повідомлення (`status.createAccountFirst`) в `#room-status`; нові тести на Enter-надсилання (успішне надсилання, ігнорування Shift+Enter, ігнорування під час IME-композиції `isComposing`); перейменовано тест, що помилково стверджував перевірку Shift+Enter, а насправді бив по клавіші "a" (exec review iter1 знахідка). 153/153 у `app.test.js`, 436/436 по проєкту.
- [x] **Impl**: `client/index.html` — `#connection-status` перенесено на екран `conversation`; повернуто окремий `#room-status` на екрані `room` для guard-повідомлень, що спрацьовують ДО навігації (exec review iter1 знахідка). `client/js/app.js` — `setStatus()` дзеркалить текст в обидва елементи; `sendChatMessage()` виділено зі спільного з новим `keydown`-обробником на `#message-input` (Enter без Shift надсилає; `isComposing`/keyCode 229 — IME-guard, exec review iter1 знахідка).
- [x] **Exec review**: iter1 — [reviews/ephemeral-spirit-mode-F6-followup-iter1.md](../reviews/ephemeral-spirit-mode-F6-followup-iter1.md). 3 знахідки (guard-повідомлення на `room`-екрані стало невидимим; відсутній IME-guard на Enter; тест з невірною назвою) — усі виправлено. iter2 — [reviews/ephemeral-spirit-mode-F6-followup-iter2.md](../reviews/ephemeral-spirit-mode-F6-followup-iter2.md), збіжність, нуль нових знахідок.

### F6-followup-2: живою перевіркою користувача виявлено — кнопка "Скопіювати запрошення" переставала реагувати на клік

User-reported bug (2026-07-17): "не можу перевірити, бо при кліку на кнопку скопіювати запрошення перестала відбуватись подія копіювання". Діагностовано підтвердженням від користувача: у момент, коли кнопка не реагує, видно нативний запит браузера на дозвіл камери/мікрофона — цей запит перехоплює кліки по решті сторінки, поки на нього не відповіли, а Секція F6 (авто-прев'ю камери) якраз одразу при вході в лобі й запускає цей запит, конкуруючи з найімовірнішою першою дією користувача (скопіювати запрошення).

- [x] **Tests**: `client/tests/app.test.js` (доповнення в описі F6) — новий `initApp`-опціон `localMediaPreviewDelayMs` затримує авто-запит камери (тест з `localMediaPreviewDelayMs: 1000` підтверджує `getUserMedia` НЕ викликається за 200мс, але викликається після завершення затримки); дефолтна поведінка (0мс, миттєво) лишається незмінною для всіх інших тестів файлу; скасування таймера на "Вийти" протягом вікна затримки — камера не вмикається повторно після logout (exec review iter1 знахідка).
- [x] **Impl**: `client/js/app.js` (`localMediaPreviewDelayMs` опція, дефолт `0`; `enterConversationLobby()` планує відкладений виклик через `setTimeout`, зберігаючи id в `state.localMediaPreviewTimeoutId`; `btn-logout` і `onChannelClose` скасовують цей таймер), `client/index.html` (продакшн-виклик тепер `initApp(document, { autoStartChat: true, localMediaPreviewDelayMs: 1500 })` замість голого `initApp(document)` — `autoStartChat: true` додано явно, щоб зберегти поведінку Секції H5, оскільки наявність об'єкта опцій змінює семантику `options === undefined`).
- [x] **Exec review**: iter1 — [reviews/chat-first-redesign-camera-permission-delay-iter1.md](../reviews/chat-first-redesign-camera-permission-delay-iter1.md). 1 знахідка (незакасований таймер міг повторно увімкнути камеру вже після logout/закриття каналу) — виправлено. iter2 — [reviews/chat-first-redesign-camera-permission-delay-iter2.md](../reviews/chat-first-redesign-camera-permission-delay-iter2.md), збіжність, нуль нових знахідок.

## Секція G1: Центрування одно-карткових екранів на десктопі

Follow-up: одно-карткові екрани (акаунт, кімната) залипали в лівій колонці 2-колоночного grid на десктопі.

- [x] **Impl**: `client/css/style.css` — `.screen > .card:only-of-type:not(.card-wide)` центрується (`grid-column:1/-1; justify-self:center; max-width:520px`); виключення `.card-wide` додано в exec review (правило спочатку звужувало `conversation`/`contacts`/`history`).
- [x] **Exec review**: iter1 — [reviews/account-centering-mru-iter1.md](../reviews/account-centering-mru-iter1.md). 1 знахідка (перекривало `.card-wide`) — виправлено.

## Секція G2: MRU-список останніх 10 акаунтів (браузер, не сайт)

- [x] **Tests**: `client/tests/session.test.js` (доповнення) — `recordRecentAccount`/`getRecentAccounts`: MRU-порядок, дедуп через переміщення на початок, обрізка до 10, пошкоджений JSON → `[]`. `client/tests/app.test.js` (доповнення) — `#profile-select` впорядковується за MRU-списком, обрізається до 10 опцій; успішний `btn-profile-unlock` записує акаунт у MRU.
- [x] **Impl**: `client/js/session.js` (`recordRecentAccount`/`getRecentAccounts`, `localStorage` ключ `spirit.recentAccounts`, окремо від `rememberSession`/24-год preselect), `client/js/app.js` (`refreshProfileSelector()` впорядковує/обрізає, `btn-profile-unlock` викликає `recordRecentAccount`).
- [x] **Exec review**: iter1 — [reviews/account-centering-mru-iter1.md](../reviews/account-centering-mru-iter1.md). Реальних знахідок для Секції G2 немає.

## Верифікація

Test-first, jsdom + fake-indexeddb, як решта проєкту. Фінал: жива перевірка в preview (клік «Швидкий анонімний чат» на одній вкладці → копіювання посилання → відкриття в другій вкладці без жодних дій → обидві сторони бачать одна одну з анонімними ніками, чат працює).
