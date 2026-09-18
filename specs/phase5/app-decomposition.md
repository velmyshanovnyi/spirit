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
