# Спека: Розбиття single-page на екрани + навігація

Розбити наявну one-page (усі секції одразу) на окремі екрани з навігацією. Уся наявна функціональність (Фази 1-2, i18n, теми, Spirit ID) зберігається; змінюється лише організація перегляду + додаються два нові екрани й (опційно) відеодзвінок.

## Екрани (маршрути)

| Маршрут | Екран | Джерело / стан |
|---|---|---|
| `#/account` | Створення акаунта (онбординг) | наявне: quick-chat, create-profile, passphrase, backup-step |
| `#/profile` | Адміністрування акаунта (профіль-пейдж) | наявне: ваш ID, селектор+unlock, backup-керування, пристрої, Google-верифікація |
| `#/server` | Адміністрування сервера | наявне: сигнальний вузол, STUN |
| `#/room` | Ініціація / приєднання до кімнати | наявне: room-id, invite-token, initiate/join, connection-status |
| `#/conversation` | Розмова (чат + відеодзвінок) | наявне: chat-log/input; **відео — нове** |
| `#/contacts` | Меню контактів | **нове** (contacts.js існує, бракує `listContacts`) |
| `#/history` | Меню історії | **нове** (historyStore.js існує, бракує `listConversations`) |

Незмінні інваріанти: усі наявні `id` елементів зберігаються (контракт app.js + 242 тестів); усі елементи існують у DOM завжди (екрани ховаються через `hidden`, не видаляються) — щоб наявні обробники/тести не ламались.

## Технічні рішення (на узгодження — див. «Відкриті питання»)

- **Роутер**: hash-based (`location.hash`), vanilla, без залежностей. Deep-link + кнопка «назад». Показує один `[data-screen]`, ховає решту. Ґейтинг: маршрути, що потребують активної identity (`profile`, `conversation`, `contacts`, `history`), при відсутності `state.senderKey` перенаправляють на `#/account`.
- **Навігація**: адаптивна — нижній таб-бар на мобільному, бічний/верхній на ПК. Пункти локалізовані (`data-i18n`), активний підсвічений.
- **Автопереходи**: після створення/розблокування профілю → `#/profile`; після встановлення з'єднання (channel open) → `#/conversation`.

## Секція N1: Hash-роутер + навігаційна оболонка

- [x] **Tests**: `client/tests/router.test.js` (jsdom, 9 тестів) — `initRouter(doc, {routes, defaultRoute, gatedRoutes, hasIdentity})`: показує рівно один `[data-screen]`, решту ховає; зміна `location.hash` перемикає екран; невідомий маршрут → defaultRoute; gated-маршрут без identity → редірект на `#/account` (синхронно, без очікування hashchange); допускає gated-маршрут з identity; клік по nav-елементу міняє hash; активний nav-пункт має `aria-current`; `navigate(route)` програмно; подвійна ініціалізація на одному document реагує лише через останній інстанс.
- [x] **Impl**: `client/js/router.js`.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/multiscreen-N1-router-iter1.md), [iter2](../reviews/multiscreen-N1-router-iter2.md). Iter1 знайшла реальний баг (gated navigate лишав старий екран видимим синхронно) — виправлено рекурсивним render() з guard-ом від misconfiguration.

## Секція N2: Міграція наявних секцій у екрани

- [x] **Tests**: `client/tests/app.test.js` — фікстура переписана під `[data-screen]`+nav, дзеркалить реальний index.html; усі 65 наявних тестів проходять без змін поведінки; нові (9): дефолтний екран, gated-редірект, ungated-доступ без identity, quick-chat→room, unlock→profile, backup-skip→profile, chat channel-open→conversation, device-linking channel-open НЕ переходить.
- [x] **Impl**: `client/index.html` (7 `[data-screen]`-секцій + nav, перегрупування: account=онбординг, profile=адміністрування+пристрої+Google, server=інфра, room=кімната+з'єднання, conversation=чат+відео-каркас), `client/js/app.js` (`initRouter`, авто-переходи на 4 identity-точках + 2 chat-точках, dedup hashchange-listener для власного рендерингу), `client/css/style.css` (`.app-nav` fixed-sidebar/sticky-tabbar, `.screen{display:contents}`). Усі id збережені.
- [x] **Exec review**: 1 ітерація (Sonnet, Opus недоступний — узгоджено з користувачем), конвергенція — [iter1](../reviews/multiscreen-N2-N4-iter1.md).

## Секція N3: Екран контактів

- [x] **Tests**: `client/tests/contacts.test.js` (доповнення, 2) — `listContacts()` повертає всі TOFU-контакти; порожній масив без контактів. `client/tests/app.test.js` (2) — екран рендерить список з форматованим Spirit ID, приховує/показує empty-state.
- [x] **Impl**: `client/js/contacts.js` (`listContacts`), `client/index.html`/`client/js/app.js` (екран, `renderContactsScreen`).
- [x] **Exec review**: разом із N2 — [iter1](../reviews/multiscreen-N2-N4-iter1.md).

## Секція N4: Екран історії

- [x] **Tests**: `client/tests/historyStore.test.js` (доповнення, 3) — `listConversations(vaultKey, profileId)` повертає {contactId, messageCount, lastMessage} на контакт, не змішуючи профілі. `client/tests/app.test.js` (2) — екран показує список розмов у профільному режимі, empty-state в ефемерному (без vaultKey).
- [x] **Impl**: `client/js/historyStore.js` (`listConversations`), `client/index.html`/`client/js/app.js` (екран, `renderHistoryScreen`).
- [x] **Exec review**: разом із N2 — [iter1](../reviews/multiscreen-N2-N4-iter1.md).

## Секція N5: Каркас відеодзвінка (рішення: каркас зараз, відео — наступним заходом)

- [x] **Tests**: `client/tests/app.test.js` — екран розмови показує disabled кнопки дзвінка/камери/мікрофона (з `data-i18n-title` "скоро") після встановлення чат-з'єднання; чат (chat-log/message-input) присутній і не заблокований каркасом.
- [x] **Impl**: `client/index.html` (video-area з двома video-tile плейсхолдерами, три disabled-кнопки з іконкою+текстом окремими spans, hint-text "скоро"), `client/css/style.css` (`.video-area`/`.video-tile`/`.hint-text`). Жодного медіа-коду у `webrtc.js` — окремий наступний захід.
- [x] **Exec review**: разом із N2 — [iter1](../reviews/multiscreen-N2-N4-iter1.md).

## Верифікація

Секції N1, N3, N4 — test-first без зовнішніх залежностей (jsdom + fake-indexeddb). N2 — наявні 242 тести лишаються зеленими + нові переходи. N5 (якщо в обсязі) — юніт із fake getUserMedia/RTCPeerConnection; реальний відеозв'язок — жива перевірка користувачем (два браузери), як мультипристрій. Фінал: жива перевірка в preview (усі екрани, навігація, light/dark, mobile) + деплой на обидва хости.

## Рішення (узгоджено з користувачем)

1. **Відеодзвінок (N5)**: каркас зараз — екран розмови з повністю робочим чатом, кнопки дзвінка/камери/мікрофона присутні, але disabled із позначкою «скоро»; повне медіа (getUserMedia + tracks + перепогодження) — окремий наступний захід.
2. **Контакти/Історія (N3/N4)**: функціональні — `listContacts`/`listConversations` додаються, екрани підключені до реальних даних активного профілю.
