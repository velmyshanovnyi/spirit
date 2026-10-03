# Ядро app.js: handleChatMessage → диспетчер контрол-повідомлень (backlog A4, етап 2)

Продовження `specs/phase5/app-decomposition.md` (R1–R9 вичерпали verbatim-
кандидатів; `app.js` 5095→3478). Залишок — переплетене ядро. Найбільший
суцільний шматок — `handleChatMessage` (~390 рядків, 16 гілок
`control.type === "…"`), кожна гілка незалежна й закінчується `return`.
Це дозволяє cut-and-stitch БЕЗ зміни поведінки: спершу розрізати на іменовані
обробники в тому самому замиканні (майже verbatim), потім виносити групи
обробників по доменах за G1-патерном DI.

## Інваріанти (не порушувати)

- **Послідовність обробки**: `state.messageDispatchLock` і порядок
  повідомлень у каналі лишаються як є; диспетчер викликається з того ж
  місця, що й `handleChatMessage` зараз.
- **Невідомий `type`** та не-JSON текст: поведінка без змін (текст →
  plain-chat гілка; відомий type без обробника неможливий за побудовою —
  набір типів виводиться з таблиці обробників).
- **Гейти** (`!state.peerFingerprint`, `vaultKey`) лишаються всередині
  кожного обробника дослівно — нічого не «виноситься вгору».
- Жодних змін у WebRTC/E2EE/сигналінгу/zero-database.

## Секція C1: розріз на обробники + таблиця диспетчера (в межах app.js)

- `CONTROL_HANDLERS` — об'єкт `{ "identity-announce": onIdentityAnnounce, … }`
  із 16 ключами (пара `mesh-relay-offer`/`mesh-relay-answer` → один
  `onMeshRelay`, як зараз). `CONTROL_MESSAGE_TYPES = new Set(Object.keys(CONTROL_HANDLERS))`
  — одне джерело істини (єдиний інший споживач set-а — сам parse у
  `handleChatMessage`).
- `handleChatMessage(text)` = parse + plain-text гілка (як є) +
  `await CONTROL_HANDLERS[control.type](control)`.
- Кожна гілка → `async function onXxx(control) { …тіло дослівно… }` поруч,
  усередині initApp (замикання, hoisting — жодних DI-змін). Єдина
  дозволена правка тіла: `return;` в кінці гілки стає зайвим (можна лишити).
- Рев'ю: multiset-порівняння видалених рядків гілок із тілами обробників
  (той самий метод, що R1–R9).
- [x] **Tests**: `app.test.js` — нові: (а) drift-guard: для кожного типу з `CONTROL_MESSAGE_TYPES` є функція в таблиці і навпаки (через тестовий експорт `__spiritControlTypes` на `win`, як інші `__spirit*`-хуки, або через відомий список 16 типів у тесті); (б) невідомий control-type (`{"type":"nope"}`) рендериться як plain-текст, як і зараз. Наявні сценарії всіх 16 типів (announce/device/proof/push/recovery/group/mesh/call/file) без змін і зелені.
- [x] **Impl**: `client/js/app.js` — таблиця, 15 обробників, `handleChatMessage` скорочено до ~30 рядків.
- [x] **Exec review**: iter1 — [reviews/core-dispatch-C1-iter1.md](../reviews/core-dispatch-C1-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

## Секція C2: домен «файли» → `client/js/fileTransferUI.js` (розширення)

Обробники `file-offer`/`file-accept`/`file-reject`/`file-chunk` + їхні
app.js-помічники `renderFileOfferBanner`, `sendFileChunks`,
`renderFileTransferDownload` (`renderFileTransferStatus` уже в модулі).
`initFileTransferUI` повертає `{ fileControlHandlers, renderFileOfferBanner, … }`;
таблиця C1 робить `...fileControlHandlers`. Залежності — `state` (pendingFileOffers,
outgoing/incomingFileTransfers, channel, sessionKey, peerFingerprint),
`encryptMessage`, `chunkToBase64`/`base64ToChunk`/`computeFileHash`/`readFileChunk`,
`noteIncomingForDrawer` (ін'єкція).
Уточнення перед кодом: переноситься весь файловий домен app.js —
`formatFileSize`, `renderFileTransferStatus`, `renderFileOfferBanner`,
`renderFileTransferDownload`, `waitForBufferedAmountLow`, `sendFileChunks`
і 4 обробники (усі споживачі цих помічників — усередині домену; grep).
Init-виклик `initFileTransferUI` переїжджає з кінця initApp на місце
помічників (~1775) — ПЕРЕД таблицею `CONTROL_HANDLERS` (const), яка робить
`...fileControlHandlers`; усі DI-залежності (`setDynamicText` 591,
`noteIncomingForDrawer` 967) визначені вище. Нові ін'єкції: `setDynamicText`,
`noteIncomingForDrawer`; `renderFileTransferStatus` більше не ін'єктується
(тепер усередині модуля). app.js прунить імпорт `fileTransfer.js` повністю.
- [x] **Tests**: наявні FT-сценарії `app.test.js` без змін і зелені; новий `client/tests/fileTransferUI.test.js` — init повертає `fileControlHandlers` із 4 ключами-функціями; `file-reject` для невідомого fileId — no-op; `file-offer` для верифікованого пера рендерить банер із назвою і кличе `noteIncomingForDrawer` (RED до створення).
- [x] **Impl**: перенос + DI в `fileTransferUI.js`; `app.js` — блок помічників + 4 обробники замінено init-викликом, таблиця spread-ить обробники; імпорт `fileTransfer.js` прунено.
- [x] **Exec review**: iter1 — [reviews/core-dispatch-C2-iter1.md](../reviews/core-dispatch-C2-iter1.md). PASS; 3 коментар-посилання оновлено; жива перевірка — в артефакті.

## Секція C3: домен «групи/mesh» → новий `client/js/groupChatHandlers.js`

Рішення: новий модуль, не розширення `groupMesh.js` — mesh-примітиви
(`initGroupMesh`) ПОТРЕБУЮТЬ `ensureLocalGroupRecord` як ін'єкцію, а
обробники потребують mesh-примітивів; один модуль мав би циклічну
ініціалізацію. Тому порядок у app.js: `initGroupChatHandlers` (дає
`ensureLocalGroupRecord`, `broadcastGroupMemberJoined`) → `initGroupMesh`
(бере `ensureLocalGroupRecord`) → mesh-примітиви ін'єктуються в обробники
лінивими thunk-ами (прийом R1/R5/R6: викликаються лише з повідомлень).

Переноситься дослівно: `broadcastGroupMemberJoined` (+ коментар GC2),
`ensureLocalGroupRecord` (+ коментар), обробники `onGroupMemberJoined`,
`onGroupMessage`, `onMeshRelay` (+ їхні коментарі). Init ставиться на місце
`broadcastGroupMemberJoined` (~1775) — ПЕРЕД `initGroupMesh` (~2329) і
таблицею. `ensureLocalGroupRecord`/`broadcastGroupMemberJoined` далі
вживаються в `onIdentityAnnounce` (ядро) — тому повертаються назовні.
DI: `t`, `state`, `getActivePeer`, `appendGroupChat`, `noteIncomingForDrawer`,
`formatSpiritId` (імпорт у модулі), contacts `getContact`, groups
`getGroup`/`ensureGroupBootstrap`/`updateGroupMembers`, `appendMessage`,
`encryptMessage` (імпорти в модулі), thunks `initiateMeshRelayConnect`,
`relayGroupMeshMessage`, `handleIncomingMeshRelayOffer`,
`handleIncomingMeshRelayAnswer`. Повертає `{ groupControlHandlers,
ensureLocalGroupRecord, broadcastGroupMemberJoined }`; таблиця робить
`...groupControlHandlers`. app.js прунить `getGroup`/`ensureGroupBootstrap`/
`updateGroupMembers`, якщо не лишається інших вживань (перевірка grep).
- [x] **Tests**: наявні GC/GM-сценарії `app.test.js` без змін і зелені; новий `client/tests/groupChatHandlers.test.js` — init повертає таблицю з 4 ключами + дві функції; `group-message` для не-тегованого peer-а — no-op (нічого не рендериться); `group-message` для тегованого рендерить через `appendGroupChat` і кличе `noteIncomingForDrawer` (RED до створення).
- [x] **Impl**: новий модуль; `app.js` — блоки замінено init-викликом перед `initGroupMesh`, таблиця spread-ить; прунінг імпортів.
- [x] **Exec review**: iter1 — [reviews/core-dispatch-C3-iter1.md](../reviews/core-dispatch-C3-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

## Секція C4: домен «анонси контакту» → новий `client/js/peerAnnouncements.js`

Обробники `device-list-announce`, `proof-set-announce`,
`push-subscription-announce`, `recovery-share-announce`, `safety-display-mode`.
Залежності: `state`, contacts.js (`getContact`, `updateContact*`),
`acceptNewerDeviceList`, `acceptNewerProofSet`, `parsePushSubscriptionAnnounce`,
`parseRecoveryShareAnnounce`, `saveTrustedShare`, `renderSafetyHint` (ін'єкція).
Уточнення: п'ять обробників — суцільний блок app.js (~1983–2040), усі їхні
імпорти (`acceptNewerDeviceList`, `acceptNewerProofSet`,
`parsePushSubscriptionAnnounce`, `parseRecoveryShareAnnounce`, `saveTrustedShare`,
`updateContactDeviceList/ProofSet/PushSubscription`) після переносу в app.js не
вживаються — прунінг; `getContact` і `renderSafetyHint` лишаються (інші
вживання). Init `initPeerAnnouncements({ state, getContact?, renderSafetyHint })`
ставиться на місце блоку (перед таблицею); `getContact` модуль імпортує сам.
Повертає `{ announcementHandlers }`; таблиця робить spread.
- [x] **Tests**: наявні сценарії `app.test.js` без змін і зелені; новий `client/tests/peerAnnouncements.test.js` — таблиця з 5 ключами-функціями; `device-list-announce` без vaultKey — no-op (contacts не чіпаються); `safety-display-mode` без гейту: ставить `state.safetyDisplayMode` і кличе `renderSafetyHint` (RED до створення).
- [x] **Impl**: новий модуль; `app.js` — блок замінено init-викликом; 8 імпортів прунено.
- [x] **Exec review**: iter1 — [reviews/core-dispatch-C4-iter1.md](../reviews/core-dispatch-C4-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

## Секція C5: домен «дзвінок/медіа» → новий `client/js/callUI.js`

Межа (визначена після C1–C4, 2026-10-03). Verbatim переносяться:
`setVideoStatus`, `updateCallButtonStates`, `previewLocalMedia`,
`acquireLocalStream`, `onWebrtcCallOffer`, `onWebrtcCallAnswer`, `startCall`,
`autoStartOwnerCall`, `onMediaToggle` і два click-обробники mic/camera.
Модуль імпортує `addLocalMediaTracks`/`createRenegotiationOffer`/
`createRenegotiationAnswer`/`applyRenegotiationAnswer` (webrtc.js) та
`encryptMessage`; DI: `doc, el, t, state`.

Точки зчеплення, що лишаються в app.js: `teardownMediaAndConnection`
(logout/leave) і `handleConnectionTornDown` (wireChannelCallbacks) — обидва
містять ОДИН І ТОЙ САМИЙ продубльований шматок (clear preview-timer, stop
tracks, `localStream=null`, скинути `localTracksAddedToPeer`/`callOfferSent`,
`updateCallButtonStates`, сховати/обнулити `#video-remote`). Єдина
не-verbatim зміна секції: цей шматок стає `stopLocalMedia()` у модулі і
викликається з обох місць (дедуплікація; у torn-down порядок дій той самий, у
teardown два прапорці скидаються раніше, ніж hideSafetyNumberHint/
resetActiveConnection — неспостережно: все синхронне, ті функції прапорців не
читають, прапорці не per-peer — review iter1;
teardown додатково робить close channel/pc + hideSafetyNumberHint +
resetActiveConnection — лишається в app.js). `enterConversationLobby`
(F6-прев'ю з таймером) і `onRemoteTrack` (у стартах сесій) — в app.js,
викликають повернені `previewLocalMedia`.

`initCallUI({ doc, el, t, state })` повертає `{ callControlHandlers,
previewLocalMedia, acquireLocalStream, updateCallButtonStates, stopLocalMedia,
setVideoStatus, autoStartOwnerCall }`. Init — на місце `setVideoStatus`
(~1762): перед `initChatSend` (бере `setVideoStatus`), перед таблицею,
перед `teardownMediaAndConnection`? — НІ: teardown (~1616) визначений РАНІШЕ
як hoisted function і викликає `stopLocalMedia` лише з click-обробників —
TDZ немає (const існує на момент кліку). `onIdentityAnnounce` кличе
`autoStartOwnerCall` (повернений const) — з повідомлень. Після C5 таблиця:
`identity-announce` + три spread-и.

- [x] **Tests**: наявні call/media-сценарії `app.test.js` (RF2 iter1–3, RF4-video, auto-answer, denied) без змін і зелені; новий `client/tests/callUI.test.js` — таблиця з 2 ключами; `webrtc-call-offer` без верифікованого пера → `video-status` = incomingRejected і `getUserMedia` не викликано; `stopLocalMedia` зупиняє треки, обнуляє `localStream`, скидає обидва прапорці, ховає `#video-remote` (RED до створення).
- [x] **Impl**: новий модуль; `app.js` — блоки замінено init-викликом; teardown/torn-down використовують `stopLocalMedia`; 4 webrtc-імпорти прунено.
- [x] **Exec review**: iter1 — [reviews/core-dispatch-C5-iter1.md](../reviews/core-dispatch-C5-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

## Лишається в ядрі app.js

`identity-announce` (зшиває верифікацію, контакти, історію, групи, recovery,
auto-call — справжнє ядро), plain-text гілка, `wireChannelCallbacks`,
ініціатор/joiner-сесії, ratchet-стан, роутінг-хуки.

## Порядок

C1 → C2 → C3 → C4 → (C5 після уточнення). Кожна секція — повний цикл.
