# Ліниве завантаження важких модулів (backlog A5)

## Контекст (діагноз із беклогу, живий вимір)

71 файл / 1.2 МБ на старті; найбільші статичні пасажири, потрібні лише зрідка:
`vendor/hash-wasm.esm.js` 265KB (Argon2 — лише детерміновані акаунти; SHA-256 —
лише передача файлів), `vendor/qrcode.esm.js` 58KB (лише QR у recovery),
`bip39-wordlist-en.js` 23KB (лише mnemonic/генератор пароля), `i18n.js` 321KB
(усі 11 локалей замість однієї). Механізм: нативний `await import()` за місцем
першого використання з кешованим module-promise — інваріант «без бандлера» не
порушується. i18n — окрема секція L4 (інший клас зміни: t() синхронний скрізь).

Верифікація лінивості — не юніт-тест (jsdom цього не бачить), а Resource Timing
наживо: vendor-файл ВІДСУТНІЙ у графі після старту і З'ЯВЛЯЄТЬСЯ після першого
використання фічі.

## Секція L1: hash-wasm за запитом

`deterministicIdentity.js` і `fileTransfer.js` замінюють статичний import на
кешований `await import("./vendor/hash-wasm.esm.js")` всередині своїх і так
асинхронних функцій. Публічні API незмінні.

- [x] **Tests**: наявні deterministicIdentity/fileTransfer-сюїти без змін і зелені (API не змінюється — RED неможливий і не потрібен; поведінкова еквівалентність = harness).
- [x] **Impl**: обидва модулі — лінивий кешований import (з retry-скиданням кешу при відмові).
- [x] **Exec review**: iter1 — [reviews/lazy-loading-L1-L3-iter1.md](../reviews/lazy-loading-L1-L3-iter1.md). PASS_WITH_NOTES, 2 нотатки виправлено; жива Resource-Timing-перевірка — в артефакті.

## Секція L2: bip39-словник за запитом

`mnemonic.js` (функції вже async) — лінивий import словника.
`generateStrongPassword` стає **async** (єдиний колсайт — обробник чекбокса
portable-акаунта в app.js, стає async+await; тестовий mock повертає рядок —
await прозорий).

- [x] **Tests**: новий кейс у `passwordGenerator.test.js` — результат тепер Promise, що резолвиться у 6-слівний пароль (RED на sync-версії); наявні mnemonic/app-сюїти зелені.
- [x] **Impl**: mnemonic.js + passwordGenerator.js ліниві; app.js — async-обробник з await.
- [x] **Exec review**: спільний iter1-артефакт (див. L1).

## Секція L3: qrcode за запитом

`qr.js`: `qrSvgMarkup` стає **async** (лінивий кешований import vendor-а).
Єдиний споживач — `recoveryUI.js` (2 колсайти, обидва в async-обробниках) —
додає await.

- [x] **Tests**: у `qr.test.js` — `qrSvgMarkup` повертає Promise→SVG-рядок (RED на sync-версії); recoveryUI/app-сюїти зелені.
- [x] **Impl**: qr.js async + 2 await у recoveryUI.js.
- [x] **Exec review**: спільний iter1-артефакт (див. L1).

## Секція L4: i18n — файл на локаль (ОКРЕМИЙ коміт, не в цьому)

- [ ] **Tests**: TBD при взятті секції.
- [ ] **Impl**: TBD.
- [ ] **Exec review**: TBD.
