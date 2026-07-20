# Спека: Групові чати (Фаза 4)

Рішення узгоджені з користувачем 2026-07-18 через AskUserQuestion: **mesh-архітектура** (N попарних P2P-з'єднань, повторне використання наявної pairwise E2EE-інфраструктури, без нового спільного групового ключа); **перший цикл — лише текстовий чат** (без групових дзвінків/відео); **повний multi-connection рефакторинг `state`** прийнятий як необхідний обсяг (не workaround з малими групами чи паралельною структурою).

## Контекст і критична архітектурна знахідка

Дослідження перед дизайном (2026-07-18) встановило: `state` в `client/js/app.js` — єдиний глобальний об'єкт з ПООДИНОКИМИ слотами (`state.pc`, `state.channel`, `state.sessionKey`, `state.sessionEcdhWires`, `state.sendChainKey`/`receiveChainKey`, `state.peerFingerprint`, `state.peerIdentityPublicKey`). Виклик `startInitiatorSession`/`startJoinerSession` вдруге в тій самій вкладці ПЕРЕЗАПИСУЄ ці слоти, а не додає друге з'єднання. Група з N учасників у mesh-моделі потребує N-1 одночасних з'єднань з однієї вкладки — це неможливо без рефакторингу.

Сигналінг (`docs/signaling-protocol.md`) підтверджено строго двосторонній: один `room_id` = рівно одна пара initiator+joiner, немає N-party примітиву. Кожен попарний зв'язок у групі потребує ВЛАСНОГО `create_invite`-виклику.

## Архітектурні рішення

1. **`state.peers`**: нова `Map`, ключована `connectionId` (випадковий, призначається на старті сесії, ДО того як `peerFingerprint` відомий — бо identity верифікується вже ПІСЛЯ встановлення з'єднання). Кожен запис — об'єкт з усіма полями, що сьогодні поодинокі на `state`: `{ pc, channel, sessionKey, sessionEcdhWires, sendChainKey, receiveChainKey, peerFingerprint, peerIdentityPublicKey, isInviteOwner, groupId }` (`groupId: null` для звичайного 1:1 чату).
2. **Зворотна сумісність 1:1-чату**: усі наявні ~15+ місць коду, що сьогодні читають `state.pc`/`state.channel`/`state.sessionKey`/`state.peerFingerprint` напряму, переписуються на доступ через `getActivePeer()`-подібний хелпер, що повертає ОДИН запис з `state.peers` (для звичайного 1:1-режиму — завжди рівно один активний запис, поведінка користувача НЕ змінюється). Це та секція, що несе найбільший ризик регресії — 640/640 наявних тестів мають лишитись зеленими БЕЗ зміни поведінки 1:1-чату.
3. **Групи (`groups.js`, новий IndexedDB store)**: запис `{ groupId, name, memberFingerprints: [...], createdAt }`. `historyStore.js`'s існуюча схема ключів (`profileId:contactId:timestamp:suffix`) розширюється підстановкою `groupId` замість `contactId` — без зміни схеми шифрування-at-rest (кожне повідомлення й так шифрується незалежно).
4. **Оркестрація приєднання нового учасника**: коли користувач додає нового учасника до групи з M наявних членів — клієнт автоматично виконує M окремих 1:1 `create_invite`-циклів (по одному на кожного наявного учасника), використовуючи наявний signaling/E2EE-стек НЕЗМІННИМ. UI показує сукупний прогрес ("з'єднано 2 з 4"), не M окремих екранів.
5. **Надсилання повідомлення в групі**: те саме plaintext незалежно шифрується (наявний `encryptMessage`/ratchet) і надсилається через КОЖЕН pairwise-канал, що належить `groupId` — просте фанаут-надсилання, без нової крипто-схеми.
6. **UI**: групова розмова рендериться в тому самому `#chat-log`-подібному компоненті, розширеному routing-шаром за `groupId`/`connectionId` замість жорсткої прив'язки до єдиного активного peer.

## Секція GC0: Multi-connection рефакторинг `state` (найризикованіша секція)

НАЙВИЩИЙ пріоритет обережності в цій секції: рефакторинг ядра, від якого залежить УВЕСЬ наявний 1:1-функціонал (640/640 тестів). Не інтегрувати жодної групової логіки в цій секції — лише зробити multi-connection можливим, зберігаючи 1:1-поведінку побайтово ідентичною.

- [x] **Tests**: `client/tests/app.test.js` — усі 640 наявних тестів лишились зеленими БЕЗ зміни жодного наявного асерту (жоден тест напряму не звертався до внутрішнього `state` — усі спостерігають лише через DOM/мокнуті виклики каналу, тож рефакторинг структури `state` був для них повністю невидимий). Додано 2 нових тести в `describe("GC0: state.peers multi-connection refactor ...")`: (1) підтверджує, що другий виклик встановлення сесії (симуляція другого з'єднання через прямі виклики на `state`) НЕ перезаписує перше — обидва одночасно присутні в `state.peers`, плюс `getPeerByFingerprint`/`getPeerByConnectionId` коректно резолвляться проти багатозаписного Map; (2) підтверджує, що `btn-logout` видаляє запис з `state.peers` повністю (розмір Map повертається до 0), а не лишає stale all-null запис. Разом: 642/642 зелені.
- [x] **Impl**: `client/js/app.js` — `state.peers` Map (`connectionId` → `{ pc, channel, sessionKey, sessionEcdhWires, sendChainKey, receiveChainKey, peerFingerprint, peerIdentityPublicKey, isInviteOwner, groupId: null }`), `state.activeConnectionId`, `getActivePeer()`/`ensureActivePeer()`/`getPeerByFingerprint()`/`getPeerByConnectionId()`/`resetActiveConnection()`-хелпери. Замість ручного переписування ~90+ місць прямого доступу, 9 колишніх поодиноких полів (`pc`, `channel`, `sessionKey`, `sessionEcdhWires`, `sendChainKey`, `receiveChainKey`, `peerFingerprint`, `peerIdentityPublicKey`, `isInviteOwner`) перетворені на `Object.defineProperty` getter/setter-пару на `state` (`PEER_PROXY_FIELDS`), що прозоро проксіює кожне читання/запис до активного запису в Map — усі наявні call site'и лишились синтаксично незмінними (`state.pc = ...`, `if (state.channel)` і т.д.), що механічно гарантує коректність (неможливо пропустити місце вручну). `btn-logout` тепер викликає `resetActiveConnection()` (видаляє запис з Map), а не обнуляє поля по одному. `initApp` додатково повертає `{ state, getActivePeer, getPeerByFingerprint, getPeerByConnectionId }` для тестового доступу (адитивно — раніше повернене значення ніде не використовувалось).
- [x] **Exec review**: 2 незалежні ітерації, обидві зійшлись. Iter1 (`specs/reviews/group-chats-GC0-iter1.md`) — фокус на коректності рефакторингу (10 перевірок: proxy-семантика, lazy-створення запису, порядок teardown, entropy connectionId, повний набір полів, неторкнуті поля, відсутність обходу проксі, коректність нових тестів) — 0 знахідок. Iter2 (`specs/reviews/group-chats-GC0-iter2.md`) — незалежний ревьюер, спеціально трасував повний lifecycle 1:1-чату (ініціатор/joiner-хендшейк, identity announce, send/receive + ratchet chain, logout/reset, device-linking reuse, video-call renegotiation) — знайшов 1 LOW-знахідку (async race: `ratchetStep`'s await + logout під час in-flight запису міг воскресити phantom-запис у `state.peers` після виходу) — виправлено (snapshot `connectionId` перед await, пропуск stale writeback у `serializedChainStep` та `onChannelOpen`), повний сьют перепрогнано (642/642 зелені), 0 незакритих знахідок.

## Секція GC1: Модель групи (сховище, membership)

Уточнено перед стартом (2026-07-18, без потреби в AskUserQuestion — чисто технічна деталізація, не архітектурне рішення): `historyStore.js`'s `appendMessage(vaultKey, profileId, contactId, {...})`/`listMessages(vaultKey, profileId, contactId)`/`listConversations(vaultKey, profileId)` уже приймають `contactId` як звичайний рядок-параметр ключа — жодних змін сигнатури не потрібно, виклики для групи просто передають `groupId` замість fingerprint-рядка (той самий тип, той самий namespace-механізм, нуль спеціальної обробки в `historyStore.js` самому).

`client/js/groups.js` (новий, мірорить стиль `contacts.js`):
- `createGroup({ name, memberFingerprints })` → генерує `groupId` (той самий випадковий hex-патерн, що й `connectionId`/`randomFileId`), зберігає `{ groupId, name, memberFingerprints, createdAt }` у новому `groups`-сторі, повертає запис.
- `getGroup(groupId)`, `listGroups()`, `updateGroupMembers(groupId, memberFingerprints)` (для GC2 — додавання нового учасника), `deleteGroup(groupId)`.
- `db.js`: `groups` додається до `STORE_NAMES`, `DB_VERSION` bump (той самий ідемпотентний upgrade-патерн, що й для `trustedShares` у Секції S2).

- [ ] **Tests**: `client/tests/groups.test.js` — CRUD для `groups`-стору (створення генерує унікальний `groupId`, `getGroup`/`listGroups`/`updateGroupMembers`/`deleteGroup` коректні, оновлення членів не чіпає `groupId`/`createdAt`); `client/tests/historyStore.test.js` (доповнення) — `appendMessage`/`listMessages` з `groupId` замість `contactId` працюють ідентично (той самий namespace-механізм, підтверджено, що групові й особисті повідомлення не змішуються навіть якщо `groupId` випадково збігається форматом з fingerprint).
- [ ] **Impl**: `client/js/groups.js` (новий, CRUD-функції, мірорить стиль `contacts.js`), `client/js/db.js` (`groups` у `STORE_NAMES`, `DB_VERSION` bump, ідемпотентний upgrade). `historyStore.js` НЕ потребує змін — `contactId`-параметр уже приймає довільний рядок-ключ без спеціальної обробки.
- [ ] **Exec review**: —

## Секція GC2: Оркестрація приєднання (M паралельних 1:1-хендшейків)

- [ ] **Tests**: TBD.
- [ ] **Impl**: TBD — координація кількох `startInitiatorSession`/`startJoinerSession`-циклів, агрегований прогрес UI.
- [ ] **Exec review**: —

## Секція GC3: Фанаут-надсилання, групова UI-розмова

- [ ] **Tests**: TBD.
- [ ] **Impl**: TBD — рендер групової розмови, надсилання в усі pairwise-канали групи.
- [ ] **Exec review**: —

## Верифікація

GC0 — старт без додаткових питань, рішення вже узгоджені, але ЖИВА перевірка звичайного 1:1-чату (не лише unit-тестів) ОБОВ'ЯЗКОВА після GC0 перш ніж рухатись далі — рефакторинг ядра з'єднання це саме той клас змін, де unit-тести можуть залишитись зеленими, а реальна поведінка зламатись (той самий урок, що вже двічі підтвердився цієї сесії: PN3, SR2). GC1-GC3 — послідовні секції, кожна на власному test-first циклі; GC2 (реальна многосторонняя WebRTC-оркестрація) теж потребує живої перевірки з кількома реальними вкладками/пристроями.
