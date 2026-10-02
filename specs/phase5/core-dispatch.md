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
- [ ] **Tests**: наявні FT-сценарії без змін; `fileTransferUI.test.js` — таблиця має 4 ключі, `file-reject` для невідомого fileId — no-op (RED).
- [ ] **Impl**: перенос + DI; app.js прунить `chunkToBase64`/`base64ToChunk`/`computeFileHash`/`readFileChunk`-імпорти, якщо більше не вживаються.
- [ ] **Exec review**: iter1.

## Секція C3: домен «групи/mesh» → `client/js/groupMesh.js` (розширення) або новий `groupChatHandlers.js`

Обробники `group-member-joined`, `group-message`, `mesh-relay-*` +
`ensureLocalGroupRecord`, `broadcastGroupMemberJoined`. Mesh-примітиви
вже в `groupMesh.js` (`initiateMeshRelayConnect`, `relayGroupMeshMessage`,
`handleIncomingMeshRelayOffer/Answer`). Залежності: `getActivePeer`,
`appendGroupChat`, `noteIncomingForDrawer`, `getContact`, `appendMessage`,
`updateGroupMembers`, `formatSpiritId`.
- [ ] **Tests**: наявні GC/GM-сценарії без змін; boundary-тест на 4 ключі (RED).
- [ ] **Impl**: перенос + DI.
- [ ] **Exec review**: iter1.

## Секція C4: домен «анонси контакту» → новий `client/js/peerAnnouncements.js`

Обробники `device-list-announce`, `proof-set-announce`,
`push-subscription-announce`, `recovery-share-announce`, `safety-display-mode`.
Залежності: `state`, contacts.js (`getContact`, `updateContact*`),
`acceptNewerDeviceList`, `acceptNewerProofSet`, `parsePushSubscriptionAnnounce`,
`parseRecoveryShareAnnounce`, `saveTrustedShare`, `renderSafetyHint` (ін'єкція).
- [ ] **Tests**: наявні сценарії без змін; boundary-тест: 5 ключів, гейт `vaultKey` → no-op (RED).
- [ ] **Impl**: перенос + DI; прунінг імпортів app.js.
- [ ] **Exec review**: iter1.

## Секція C5: домен «дзвінок/медіа» → новий `client/js/callUI.js`

Обробники `webrtc-call-offer`/`webrtc-call-answer` + `previewLocalMedia`,
`acquireLocalStream`, `updateCallButtonStates`, `startCall`, `autoStartOwnerCall`,
`onMediaToggle`, `setVideoStatus`, `teardownMediaAndConnection`(?) — межа
визначається ПІСЛЯ C1 (частина цього ще сплетена з wireChannelCallbacks /
logout). Окремий підрозділ спеки перед стартом.
- [ ] **Tests**: —
- [ ] **Impl**: —
- [ ] **Exec review**: —

## Лишається в ядрі app.js

`identity-announce` (зшиває верифікацію, контакти, історію, групи, recovery,
auto-call — справжнє ядро), plain-text гілка, `wireChannelCallbacks`,
ініціатор/joiner-сесії, ratchet-стан, роутінг-хуки.

## Порядок

C1 → C2 → C3 → C4 → (C5 після уточнення). Кожна секція — повний цикл.
