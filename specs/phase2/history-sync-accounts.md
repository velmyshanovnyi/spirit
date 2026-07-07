# Спека: Фаза 2 (залишки) — Історія, транспорт device-списку, мультиакаунти

Закриває пункти первісного плану Фази 2 ([roadmap.md](../../docs/roadmap.md)), не покриті [profiles.md](profiles.md): зашифрована історія повідомлень, розповсюдження підписаного device-списку контактам, мультиакаунти в UI.

Джерело істини: [docs/accounts.md](../../docs/accounts.md), [docs/e2ee.md](../../docs/e2ee.md), [docs/decisions.md](../../docs/decisions.md).

## Технічні рішення (на підтвердження користувачем)

1. **Утримання vault-ключа в пам'яті сесії.** Історія шифрується vault-ключем (той самий PBKDF2→AES-GCM, що й приватний ключ). Це вимагає тримати `CryptoKey` vault-а в пам'яті вкладки після розблокування профілю (сам `CryptoKey` non-extractable — сирі байти ключа JS-коду недоступні). Ефемерний режим історію не пише взагалі.
2. **Автентифікований обмін identity.** Поточний хендшейк обмінює лише ECDH-ключі — співрозмовник НЕ доводить свою identity. Для збереження device-списку "контакта" потрібно знати його identity-ключ автентифіковано. Рішення: перше повідомлення сесії — `identity-announce`: identity public key + підпис identity-ключем над обома session-ECDH ключами (доменний префікс). Побічний виграш: закриває MITM сигнального вузла для контактів, чий ключ уже відомий (TOFU + звірка збереженого ключа), що досі було лише ручною звіркою fingerprint.
3. **Мультиакаунти без міграції формату.** Записи профілів переходять з одного ключа `"identity"` на ключі-ідентифікатори (fingerprint); старий запис `"identity"` читається як fallback і переноситься при першому розблокуванні (лінива міграція, без breaking change).

## Секція 11: Vault-сесія та зашифроване сховище історії

- [x] **Tests**: `client/tests/historyStore.test.js` (7 тестів, fake-indexeddb, реальна крипто) — `appendMessage` пише запис без plaintext у db (probe і по значенню, і по ключу); `listMessages` — хронологічний порядок навіть при записі не по порядку, включно з пасткою лексикографічного сортування "999 vs 1000"; ізоляція контактів; два повідомлення в одну мілісекунду не перезаписуються; невірний vault-ключ → throw, не сміття; порожня історія → `[]`. `client/tests/profile.test.js` (доповнення, 2 тести) — `createPermanentProfile`/`loadPermanentProfile` повертають `vaultKey`; ключ від load розшифровує зашифроване ключем від create (той самий матеріал).
- [x] **Impl**: `client/js/historyStore.js` (новий) — ключ запису `<contactId>:<timestamp zero-pad 16>:<4 випадкові байти>`, значення — AES-GCM ciphertext серіалізованого повідомлення; `client/js/profile.js` — `persistRawIdentity` повертає vaultKey, `create`/`load` повертають `{...keyPair, vaultKey}` (spread зберігає сумісність з наявними споживачами), спільний `decryptStoredRawIdentity` повертає обидва.
- [x] **Exec review**: 1 ітерація, конвергенція — [iter1](../reviews/phase2-section-11-history-iter1.md). **Перенесено до Секції 14 (обов'язково)**: `adoptIdentity`/`restoreProfileFrom*` відкидають vaultKey — після link/restore сесія лишається без нього, дротування історії мусить це закрити.

## Секція 12: Автентифікований identity-announce у хендшейку

- [x] **Tests**: `client/tests/identityAnnounce.test.js` (6 тестів, реальна крипто) — round-trip з дзеркальними local/peer ECDH-wire; відхилення: перенос у чужу сесію, echo власного announce назад (reflection), підмінений identity-ключ після підпису, підпис не тим ключем, що анонсовано, malformed (null, не кидає). `client/tests/contacts.test.js` (3 тести) — TOFU-реєстр: new/known, firstSeen не перезаписується. `client/tests/app.test.js` (доповнення, 6 тестів) — чат-флоу шлють зашифрований announce щойно канал+session key готові (у будь-якому порядку); валідний вхідний → fingerprint у статусі, збереження контакта лише у профільному режимі; невалідний → попередження; вхідний текст відхиляється до верифікації і приймається після.
- [x] **Impl**: `client/js/identityAnnounce.js` (новий) — payload `spirit-identity-announce-v1|<pubkey>|<senderEcdh>|<receiverEcdh>` (прив'язка до сесії — анти-replay/reflection/MITM-transplant); `client/js/contacts.js` (новий) — TOFU-реєстр за fingerprint (`deviceList: null` — заповнить Секція 13); `client/js/app.js` — `handleChatMessage` (роутинг контрольних типів, гейтування вхідного тексту на `peerFingerprint`), `makeIdentityAnnouncer` (one-shot, канал+ключ у будь-якому порядку), `state.sessionEcdhWires` у обох session-хелперах, скидання стану на новий чат.
- [x] **Exec review**: 1 ітерація, конвергенція — [iter1](../reviews/phase2-section-12-identity-announce-iter1.md). Побайтово перевірено echo/transplant/mirror-логіку; за зауваженням покриття додано reflection-тест з тими самими ключами.

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
