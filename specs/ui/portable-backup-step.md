# Portable-акаунт: backup-крок без mnemonic/keyfile (backlog A13)

**Проблема.** Після створення portable-акаунта (`portable-account-checkbox`)
`adoptScalarIdentity` → `adoptIdentity` повертає non-extractable CryptoKey
(свідомо, як `loadPermanentProfile`). Backup-крок показує ті самі
`btn-backup-mnemonic`/`btn-backup-keyfile`, що й для random-акаунта; обидва
викликають `exportPrivateKeyScalar`/`exportPrivateKeyRaw` і падають з
`key is not extractable`, причому помилка йде лише в глобальний статус-бар.

**Рішення (варіант «а» з backlog).** Для portable-акаунта backup і є
login-рядок `spirit<name><tail>` + пароль (відновлюваний на будь-якому вузлі,
H3/H4). Тому в backup-кроці для portable ховаємо експорт-контроли й показуємо
підказку; для random-акаунта — як було.

## Секція P1: умовний backup-крок

- Markup: експорт-контроли (`btn-backup-mnemonic`, поле+кнопка keyfile,
  `mnemonic-display`, `keyfile-display`) обгортаються в `#backup-key-exports`;
  додається `#backup-portable-hint` (hidden, `data-i18n="backup.portableHint"`).
  `btn-backup-skip` лишається поза обгорткою — спільний для обох.
- `profileUI.js` (`btn-profile-confirm`): після встановлення ідентичності
  `el("backup-key-exports").hidden = portable; el("backup-portable-hint").hidden = !portable;`
  де `portable = el("portable-account-checkbox").checked` (читається ДО очищення
  форми, в тій самій гілці, що вже існує).
- i18n: ключ `backup.portableHint` в en+uk та всіх 9 `locales/*.js` (тест паритету
  локалей вимагає повного набору ключів), текст: логін + пароль і є резервною
  копією; збережіть їх.

- [x] **Tests**: `app.test.js` — у portable-create тесті після появи login-рядка `#backup-key-exports` hidden, `#backup-portable-hint` видимий; у random-create тесті — навпаки (RED до impl). `i18n.test.js`-паритет en/uk покриває новий ключ, якщо такий тест є.
- [x] **Impl**: `client/index.html`, `client/js/profileUI.js`, `client/js/i18n.js`, `client/js/locales/*.js`.
- [x] **Exec review**: iter1 — [reviews/portable-backup-step-P1-iter1.md](../reviews/portable-backup-step-P1-iter1.md). PASS, 0 знахідок; жива перевірка — в артефакті.
