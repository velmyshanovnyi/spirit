# Декомпозиція app.js — продовження G1 (backlog A4)

## Контекст

`client/js/app.js` — 5095 рядків, God object: майже вся логіка живе в одному
замиканні `initApp()`. Секція G1 (фаза 4) винесла 5 UI-модулів за патерном
ін'єкції залежностей (`initXxxUI({ doc, el, t, state, ... })`, `state` —
за посиланням); цей спек продовжує той самий патерн — **по одному зв'язному
домену за секцію, без зміни поведінки**, кожна секція з власним review.

## Секція R1: recovery-домен → `client/js/recoveryUI.js`

Обсяг (~340 рядків, три блоки app.js):
1. Картка «Соціальне відновлення»: `renderRecoveryCard`,
   `renderRecoveryThresholdOptions`, `setRecoveryStatus`, обробники
   `recovery-held-list` (click), `recovery-contacts-list` (change),
   `btn-setup-recovery` (Shamir split + негайне надсилання/черга).
2. Outbox часток: `recoveryShareOutboxKey`, `queueRecoveryShareForContact`,
   `dequeueRecoveryShareForContact`, `drainRecoveryShareOutboxForPeer`.
   (`broadcastGroupMemberJoined` — НЕ recovery, лишається в app.js.)
3. Відновлення з часток: `setRecoveryRestoreStatus`,
   `link-toggle-recovery-restore` (click), `btn-recover-from-shares`.

Межа доведена grep-ом: назовні використовуються лише `renderRecoveryCard`
(8 колсайтів у обробниках + передача в `initDeviceLinkingUI`) і
`drainRecoveryShareOutboxForPeer` (1 колсайт у `handleChatMessage`) — саме
їх повертає `initRecoveryUI(...)`. Решта символів — внутрішні.

Залежності: stateless-модулі (shamir/recoveryShare/e2ee/db/profile/qr/...)
імпортуються напряму; замиканнєве (`doc`, `el`, `t`, `state` за посиланням,
`withBusyButton`, `setDynamicText`, `resetOwnProofsState`,
`renderGuestQuickActions`, `renderNotificationsCard`,
`refreshProfileSelector`, `readSessionTtlHours`, `postIdentityRoute`,
`router`) — ін'єктується, як у deviceLinkingUI.js. Виклик `initRecoveryUI`
ставиться на місце блоку відновлення (після визначення `router` на ~1732 —
всі const-стрілки серед залежностей уже визначені). Перенесення реєстрації
трьох слухачів у пізнішу точку ініціалізації поведінки не змінює (ті самі
елементи, конкуруючих обробників немає).

Інваріант секції: жодної зміни поведінки; наявні recovery-тести в
`app.test.js` (62 згадки, Секції S2/S3) — основний harness.

- [x] **Tests**: наявні recovery-сценарії `app.test.js` без змін і зелені (harness незмінної поведінки); новий `client/tests/recoveryUI.test.js` — модуль існує й експортує `initRecoveryUI`, а `initRecoveryUI` повертає `{ renderRecoveryCard, drainRecoveryShareOutboxForPeer }` (RED до створення модуля).
- [x] **Impl**: новий `client/js/recoveryUI.js`; `client/js/app.js` — три блоки замінено одним викликом `initRecoveryUI`, деструктуризація двох повернених функцій під наявними іменами.
- [x] **Exec review**: iter1 — [reviews/app-decomposition-R1-iter1.md](../reviews/app-decomposition-R1-iter1.md). PASS_WITH_NOTES, 2 знахідки виправлено; verbatim-еквівалентність підтверджено мультимножинним порівнянням; жива перевірка — в артефакті.

## Секція R2: mesh-реле (GC4) → `client/js/groupMesh.js`

Обсяг (~194 рядки, один суцільний блок app.js): `wireMeshRelayChannelCallbacks`
(внутрішня), `initiateMeshRelayConnect`, `relayGroupMeshMessage`,
`handleIncomingMeshRelayOffer`, `handleIncomingMeshRelayAnswer` — увесь
GC4-домен «фонові пари через реле» переноситься verbatim.

Межа доведена grep-ом: назовні використовуються лише 4 функції
(`initiateMeshRelayConnect` — 1 колсайт, `relayGroupMeshMessage`,
`handleIncomingMeshRelayOffer`, `handleIncomingMeshRelayAnswer` — по 1
колсайту в `handleChatMessage`); саме їх повертає `initGroupMesh(...)`.
`state.pendingMeshRelays` / `state.messageDispatchLock` — поля спільного
`state`, що передається за посиланням (як у R1/G1), нових полів немає.

Залежності: stateless — напряму (`webrtc.js`: startAsInitiator/startAsJoiner/
applyRemoteAnswer; `identity.js`: generateEcdhKeyPair/export/importEcdhPublicKeyForWire;
`e2ee.js`: deriveSessionKey/encryptMessage/decryptMessage). Ін'єктується
замиканнєве: `state`, `handleChatMessage`, `randomConnectionId`,
`createPeerEntry`, `getGroupPeerByFingerprint`, `makeEntryIdentityAnnouncer`,
`currentRtcConfig`, `ensureLocalGroupRecord` — усі hoisted function
declarations, тож виклик `initGroupMesh` на місці блоку не має TDZ-ризиків;
усі 4 зовнішні колсайти живуть в обробниках повідомлень (виконуються після
завершення ініціалізації).

Інваріант секції: жодної зміни поведінки; наявні GC4/mesh-тести в
`app.test.js` — основний harness.

- [x] **Tests**: наявні mesh/GC4-сценарії `app.test.js` без змін і зелені; новий `client/tests/groupMesh.test.js` — модуль існує, `initGroupMesh` повертає 4 функції; `relayGroupMeshMessage` шле re-encrypted control лише verified same-groupId peer-у і мовчки дропає без шляху (RED до створення модуля).
- [x] **Impl**: новий `client/js/groupMesh.js`; `client/js/app.js` — блок замінено викликом `initGroupMesh`, деструктуризація 4 функцій під наявними іменами.
- [x] **Exec review**: iter1 — [reviews/app-decomposition-R2-iter1.md](../reviews/app-decomposition-R2-iter1.md). PASS_WITH_NOTES, 0 знахідок, 1 нотатка прийнята; жива перевірка — в артефакті.

## Секція R3: конфіг сервера/адмінка/вузли → `client/js/serverConfigUI.js`

Примітка про зміну плану: кандидат «дзвінки/медіа (`callMedia.js`)» відкладено —
розвідка показала, що це НЕ суцільний домен (renegotiation-гілки всередині
`handleChatMessage`, video-dock всередині рендер-замикання роутера, обробники
кнопок окремо) — його винос був би high-risk cut-and-stitch, а не verbatim-move.
Натомість узято наступний за чистотою суцільний кластер.

Обсяг (~250 рядків, два блоки app.js):
1. 2035–2266: `setAdminStatus`, `renderAdminConfig` (+`ADMIN_CONFIG_FIELDS`
   з module-scope), STUN/TURN-пресети (константи + 4 слухачі полів),
   signaling-вузли (`SIGNALING_NODES_KEY`, `loadSignalingNodes`,
   `saveSignalingNodes`, `randomSignalingNodeId`, `renderSignalingNodesList`
   + стартовий виклик + обробники save/select/delete).
2. ~2294–2309: обробник `btn-admin-login`.

Межа доведена grep-ом: **нуль** зовнішніх споживачів — усі вживання символів
кластера всередині нього. `initServerConfigUI(...)` нічого не повертає.
Залежності: stateless напряму (`adminAuth.js`, `turnCredentials.js`);
ін'єктується лише `doc`, `el`, `t`, `withBusyButton`. `state` НЕ потрібен.
Стартовий виклик `renderSignalingNodesList()` виконується всередині init —
виклик `initServerConfigUI` ставиться на місце блоку 1, тайминг ідентичний.

- [x] **Tests**: наявні server/admin/signaling-nodes/STUN/TURN-сценарії `app.test.js` без змін і зелені (harness); новий `client/tests/serverConfigUI.test.js` — модуль існує й `initServerConfigUI` рендерить список вузлів із localStorage при init (RED до створення).
- [x] **Impl**: новий `client/js/serverConfigUI.js`; `client/js/app.js` — два блоки замінено одним викликом; `ADMIN_CONFIG_FIELDS` переїжджає в модуль.
- [x] **Exec review**: iter1 — [reviews/app-decomposition-R3-iter1.md](../reviews/app-decomposition-R3-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.

## Секція R4: імпортовані контакти (I2/I3) → `client/js/importedContactsUI.js`

Обсяг (~215 рядків, один суцільний блок app.js 1239–1451): `setImportStatus`,
`renderImportedContactsScreen`, евристики `deriveImportedHistoryDisplayName` /
`inferImportedDirection`, обробник `import-file-input` (парсинг vcard/telegram/
whatsapp) і делегований обробник `import-pending-list` (match/delete + єдина
точка запису імпортованої історії в historyStore).

Межа доведена grep-ом: назовні використовується лише
`renderImportedContactsScreen` (2 колсайти: `checkContactProofs`,
`onScreenChange`) — його повертає `initImportedContactsUI(...)`.
Залежності: stateless напряму (`importedContacts.js` повним набором,
`importParsers.js`, `historyStore.js:appendMessage`, `contacts.js:listContacts`,
`spiritId.js:formatSpiritId`); ін'єктується `doc`, `el`, `t`, `state`
(читає nickname / identityKeyPair.vaultKey / senderKey — за посиланням,
як у R1/R2). Виклик init — на місці блоку; тайминг реєстрації слухачів
ідентичний.

- [x] **Tests**: наявні import-сценарії `app.test.js` (Секції I2/I3) без змін і зелені; новий `client/tests/importedContactsUI.test.js` — модуль існує, `initImportedContactsUI` повертає `renderImportedContactsScreen`, евристика напрямку «out» лише для власного нікнейму (RED до створення).
- [x] **Impl**: новий `client/js/importedContactsUI.js`; `client/js/app.js` — блок замінено викликом init.
- [x] **Exec review**: iter1 — [reviews/app-decomposition-R4-iter1.md](../reviews/app-decomposition-R4-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.
