# Спека: Фаза 2 (залишки) — Історія, транспорт device-списку, мультиакаунти

Закриває пункти первісного плану Фази 2 ([roadmap.md](../../docs/roadmap.md)), не покриті [profiles.md](profiles.md): зашифрована історія повідомлень, розповсюдження підписаного device-списку контактам, мультиакаунти в UI.

Джерело істини: [docs/accounts.md](../../docs/accounts.md), [docs/e2ee.md](../../docs/e2ee.md), [docs/decisions.md](../../docs/decisions.md).

## Технічні рішення (на підтвердження користувачем)

1. **Утримання vault-ключа в пам'яті сесії.** Історія шифрується vault-ключем (той самий PBKDF2→AES-GCM, що й приватний ключ). Це вимагає тримати `CryptoKey` vault-а в пам'яті вкладки після розблокування профілю (сам `CryptoKey` non-extractable — сирі байти ключа JS-коду недоступні). Ефемерний режим історію не пише взагалі.
2. **Автентифікований обмін identity.** Поточний хендшейк обмінює лише ECDH-ключі — співрозмовник НЕ доводить свою identity. Для збереження device-списку "контакта" потрібно знати його identity-ключ автентифіковано. Рішення: перше повідомлення сесії — `identity-announce`: identity public key + підпис identity-ключем над обома session-ECDH ключами (доменний префікс). Побічний виграш: закриває MITM сигнального вузла для контактів, чий ключ уже відомий (TOFU + звірка збереженого ключа), що досі було лише ручною звіркою fingerprint.
3. **Мультиакаунти без міграції формату.** Записи профілів переходять з одного ключа `"identity"` на ключі-ідентифікатори (fingerprint); старий запис `"identity"` читається як fallback і переноситься при першому розблокуванні (лінива міграція, без breaking change).

## Секція 11: Vault-сесія та зашифроване сховище історії

- [ ] **Tests**: `client/tests/historyStore.test.js` (fake-indexeddb, реальна крипто) — `appendMessage(vaultKey, contactId, {direction, text, timestamp})` пише запис, `text` у db відсутній у відкритому вигляді; `listMessages(vaultKey, contactId)` повертає повідомлення в хронологічному порядку, розшифровані; повідомлення різних контактів не змішуються; невірний vault-ключ → помилка розшифровки, не сміття. `client/tests/profile.test.js` (доповнення) — `createPermanentProfile`/`loadPermanentProfile` повертають також `vaultKey` (CryptoKey, non-extractable), придатний для `encryptForVault`/`decryptForVault`.
- [ ] **Impl**: `client/js/historyStore.js` (новий) — ключ запису `<contactId>:<timestamp>:<seq>`, значення — AES-GCM ciphertext серіалізованого повідомлення; `client/js/profile.js` — повернення `vaultKey` поруч із keyPair (без зміни збереженого формату).
- [ ] **Exec review**: —

## Секція 12: Автентифікований identity-announce у хендшейку

- [ ] **Tests**: `client/tests/identityAnnounce.test.js` (реальна крипто) — `createIdentityAnnounce(identityPrivateKey, identityPublicKey, localEcdhWire, peerEcdhWire)` → перевірюване повідомлення; `verifyIdentityAnnounce(announce, localEcdhWire, peerEcdhWire)` повертає identity public key + fingerprint для валідного, відхиляє: підмінений identity-ключ, чужі ECDH-ключі (захист від переносу announce в іншу сесію), malformed. `client/tests/app.test.js` (доповнення) — обидва чат-флоу надсилають announce після встановлення session key; отриманий announce зберігає контакт (TOFU); розбіжність зі збереженим ключем контакта → чітке попередження в UI, повідомлення не приймаються.
- [ ] **Impl**: `client/js/identityAnnounce.js` (новий), `client/js/app.js` — надсилання/приймання в обох чат-флоу; `client/js/contacts.js` (новий) — збереження контактів у db: `{identityPubkey, fingerprint, firstSeen, deviceList}`.
- [ ] **Exec review**: —

## Секція 13: Транспорт device-списку контактам

- [ ] **Tests**: `client/tests/app.test.js`/`contacts.test.js` (доповнення) — після identity-announce сторона з наявним device-списком надсилає `device-list-announce`; отримувач застосовує `acceptNewerDeviceList` проти identity-ключа контакта і зберігає результат у записі контакта; replay старішого списку не понижує збережений.
- [ ] **Impl**: `client/js/app.js` (доповнення), `client/js/contacts.js` (доповнення) — зберігання/оновлення `deviceList` контакта.
- [ ] **Exec review**: —

## Секція 14: Дротування історії в чат-UI

- [ ] **Tests**: `client/tests/app.test.js` (доповнення) — у профільному режимі надіслані й отримані повідомлення пишуться через `historyStore` під fingerprint контакта (відомим з announce); в ефемерному режимі — не пишуться; при встановленні сесії з відомим контактом попередня історія рендериться в чат-лог.
- [ ] **Impl**: `client/js/app.js` (доповнення).
- [ ] **Exec review**: —

## Секція 15: Мультиакаунти в UI

- [ ] **Tests**: `client/tests/profile.test.js` (доповнення) — `listProfiles()` повертає збережені профілі (id + мітка); `createPermanentProfile` додає, не перезаписуючи наявні; `loadPermanentProfile(profileId, passphrase)` розблоковує конкретний; legacy-запис `"identity"` читається і лінивo мігрується. `client/tests/app.test.js` (доповнення) — селектор профілю показує список, вибір + passphrase розблоковує обраний.
- [ ] **Impl**: `client/js/profile.js` (розширення схеми ключів записів), `client/index.html`/`client/js/app.js` (селектор).
- [ ] **Exec review**: —

## Верифікація

Усі секції — test-first без зовнішніх залежностей (fake-indexeddb + реальна Web Crypto, UI — jsdom з моками, як усталено). Живий тест "два браузери, історія + device-список" — ручна верифікація користувачем після завершення, разом із відкладеним живим тестом мультипристрою.
