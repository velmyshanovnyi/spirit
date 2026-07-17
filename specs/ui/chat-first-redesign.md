# Спека: Chat-first редизайн — без реєстрації, модалка привітання, налаштування-меню

Записано за прямим запитом користувача (2026-07-17). Мета: новий відвідувач має змогу одразу писати в чат без жодної реєстрації; навігація й акаунт-дії переїжджають у модалки/меню налаштувань, щоб не заважати. Користувач явно дозволив пропускати AskUserQuestion там, де потрібне уточнення — "використовуй навігацію в кращих традиціях Telegram" (розумні дефолти, без зайвих питань).

## Секція H1: Welcome-модалка при першому заході

- [x] **Tests**: `client/tests/app.test.js` — модалка показується при `initApp()`, якщо `localStorage.spirit.welcomeSeen` відсутній; кнопка підтвердження закриває модалку і ставить прапорець; повторний `initApp()` (прапорець уже є) модалку не показує; app не падає, якщо `localStorage` кидає виняток (exec review iter1 знахідка). 5/5 нових тестів, 441/441 по проєкту.
- [x] **Impl**: `client/index.html` (`div#welcome-modal` overlay з коротким описом + інструкцією), `client/js/app.js` (показ/закриття + `localStorage`, обгорнуто в try/catch за наявним патерном `theme.js`/`i18n.js`), `client/css/style.css` (`.modal-overlay`/`.modal-card`, `z-index:100` із запасом для майбутніх H4-модалок), `client/js/i18n.js` (нові ключі `welcome.title/body/confirm` у всіх 11 локалях).
- [x] **Exec review**: iter1 — [reviews/chat-first-redesign-H1-iter1.md](../reviews/chat-first-redesign-H1-iter1.md). 1 знахідка (незахищений `localStorage` міг завалити весь `initApp`) — виправлено. iter2 — [reviews/chat-first-redesign-H1-iter2.md](../reviews/chat-first-redesign-H1-iter2.md), збіжність, нуль нових знахідок.

## Секція H2: Налаштування-меню замість верхньої навігації

- [x] **Tests**: клік на кнопку "⚙️ Налаштування" (праворуч від theme-toggle) відкриває панель з пунктами Профіль/Кімната/Чат/Контакти/Історія/Сервер/Вийти; клік по пункту закриває панель; клік поза межами панелі закриває її (Telegram-стиль); повторний клік на toggle закриває; "Вийти" скидає ідентичність, закриває будь-яке активне з'єднання, зупиняє локальні медіа-треки, скидає ratchet/invite-owner прапорці (exec review iter1 знахідка) і повертає на екран "account". 6/6 нових тестів.
- [x] **Impl**: `client/index.html` (`#btn-settings-toggle` + `#settings-menu` dropdown, наявні `.nav-item` посилання перенесені туди ж, "Акаунт" лишився в DOM для роутера, але прихований — доступ тепер через H3), `client/css/style.css` (`.settings-wrap`, `z-index:101`), `client/js/app.js` (toggle/outside-click/close-on-item-click логіка, обробник `btn-logout` через наявний `forgetSession()`), `client/js/i18n.js` (`menu.settings`/`menu.logout` у 11 локалях).
- [x] **Exec review**: iter1 — [reviews/chat-first-redesign-H2-H3-iter1.md](../reviews/chat-first-redesign-H2-H3-iter1.md). 2 знахідки (дубльовані виклики `renderGuestQuickActions()` через мех. заміну; logout не скидав `isInviteOwner`/`localTracksAddedToPeer`/`peerIdentityPublicKey`) — обидві виправлено. iter2 — [reviews/chat-first-redesign-H2-H3-iter2.md](../reviews/chat-first-redesign-H2-H3-iter2.md), збіжність, нуль нових знахідок.

## Секція H3: Ліва панель швидких дій для неавторизованих

- [x] **Tests**: якщо немає `state.senderKey`, ліворуч від вибору мови показуються "Створити"/"Увійти"; якщо є identity — прихована; знову з'являється після "Вийти". 3/3 нових тестів.
- [x] **Impl**: `client/index.html` (`#guest-quick-actions`), `client/js/app.js` (`renderGuestQuickActions()`, викликається при кожному встановленні/скиданні ідентичності — 7 точок входу через `resetOwnProofsState()`-патерн). **Примітка**: "Створити"/"Увійти" наразі перевикористовують наявний тумблер `link-switch-to-create`/`link-switch-to-login` на екрані "account" (не справжні модалки) — повне модальне подання відкладено до Секції H4.
- [x] **Exec review**: разом із H2, див. вище.

## Секція H5: Дефолтна сторінка — чат без реєстрації ✅ ЗАВЕРШЕНО

Автоматичне створення ефемерної identity + кімнати одразу при завантаженні (без кліку), якщо немає invite-посилання й немає збереженого профілю/сесії — перетворення наявного одноклікового `btn-quick-chat` (Секція F3) на нуль-клікове, за тим самим патерном, що вже є для приєднання за invite-лінком (Секція F4).

**Як вирішено проблему blast radius**: замість перевірки stored-profiles через async `listProfiles()` (IndexedDB) — синхронна перевірка `getRememberedProfileId()` (localStorage). Ключове рішення: `initApp(doc, options)` тепер визначає `autoStartChat = options === undefined` — true лише коли викликач не передав ДРУГИЙ аргумент взагалі (так викликає реальний `index.html`: `initApp(document)`), і false щоразу, коли передано об'єкт опцій (усі 171 наявні тести в `app.test.js` завжди передають об'єкт, навіть мінімальний `{locale:"uk"}`). Емпірично підтверджено: 0 "голих" викликів `initApp(document)` серед 142 у тест-файлі. Це дало 100% зворотну сумісність без жодної зміни в наявних тестах.

- [x] **Tests**: `client/tests/app.test.js` — новий describe "zero-click default landing on chat, no registration (Section H5)" (5 тестів): regression guard (звичайний `initApp()` НЕ автозапускає); позитивний тест з `{autoStartChat: true}` (доходить до екрана "conversation" з видимим invite-баром); НЕ автозапускається, якщо є remembered session; НЕ автозапускається, якщо є invite-лінк (F4 бере гору); manual-клік під час авто-старту — no-op (re-entrancy guard). 171/171 у `app.test.js`, 455/455 по проєкту.
- [x] **Impl**: `client/js/app.js` (сигнатура `initApp` змінена на `(doc, options)` з умовним дефолтом `autoStartChat`; новий `else if (autoStartChat && !getRememberedProfileId())` блок одразу після F4-гілки, перевикористовує спільний `initiateChatSession()`), `client/js/session.js` (`getRememberedProfileId()` тепер захищений try/catch навколо `localStorage.getItem` — exec review iter1 знахідка, захищає ВСІХ викликачів, не лише H5).
- [x] **Exec review**: iter1 — [reviews/chat-first-redesign-H5-iter1.md](../reviews/chat-first-redesign-H5-iter1.md). 1 знахідка (незахищений `localStorage.getItem` у продакшн-лише коді-шляху міг завалити весь `initApp`) — виправлено на рівні спільної утиліти `session.js`. iter2 — [reviews/chat-first-redesign-H5-iter2.md](../reviews/chat-first-redesign-H5-iter2.md), збіжність, нуль нових знахідок.

## Секція H4: Створити/Увійти як повноцінні модалки (НЕ ПОЧАТО)

Наразі (Секція H3) кнопки "Створити"/"Увійти" лише навігують на екран "account" і перемикають наявний тумблер — не справжні модалки поверх чату, як просив користувач. Повне перенесення форм `account-create-mode`/`account-login-block` (Секції H1-H4 `specs/phase3/deterministic-accounts.md`) у `.modal-overlay` (той самий компонент, що й H1's welcome-модалка) — окрема секція, великий blast radius на наявні profile/account тести (сотні асертів очікують ці елементи на екрані "account", не в модалці).

- [ ] **Tests**: TBD
- [ ] **Impl**: TBD
- [ ] **Exec review**: —

## Секція H6: Invite-посилання одразу відкриває чат з новим ефемерним іменем ✅ ЗАВЕРШЕНО (без нового коду)

Живо перевірено 2026-07-17 на `spirit.kolo.media`: перехід за посиланням-запрошенням (`?room=&token=#/room`) одразу дає `hash="#/conversation"` (не проміжний екран), welcome-модалка коректно НЕ показується (приєднувач — не "перший огляд сайту"), кожен вхід генерує новий випадковий ефемерний нік через `generateAnonymousNickname()` (F4, вже було). Секції F4+F6 разом уже повністю покривають цю вимогу — жодних змін коду не знадобилось.

## Порядок виконання

H1 → H2 → H3 → H6 (перевірка) → H5 → H4, за спаданням співвідношення цінність/ризик.

**Стан на 2026-07-17**: H1, H2, H3, H6 — ✅ завершено (тести, exec-review, коміт, деплой на kolomedi+kibr, жива перевірка). H5, H4 — не почато, обидва явно позначені як великі за blast radius на наявний тест-сьют; конкретні рекомендації для наступного волонтера записані в самих секціях вище. Секції без явного рішення користувача щодо деталей — розумні дефолти в дусі Telegram Web (мінімалістичні модалки, іконки-кнопки), без додаткових уточнюючих питань.
