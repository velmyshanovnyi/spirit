# Спека: Фаза 2 — Профілі, backup та мультипристрій

Реалізація [accounts.md](../../docs/accounts.md): перманентні зашифровані профілі в IndexedDB, backup identity-ключа (мнемоніка + keyfile — одне кодування секрету), мультипристрій через device-linking сертифікати.

Джерело істини: [docs/accounts.md](../../docs/accounts.md), [docs/decisions.md](../../docs/decisions.md) (D8, D9).

## Технічні рішення (узгоджено з користувачем)

- **KDF: PBKDF2**, не Argon2 — нативний у Web Crypto API, без WASM-залежності, узгоджено з підходом проєкту (жодних зовнішніх крипто-бібліотек у Фазі 1). Рекомендована кількість ітерацій — 600 000+ (сучасна рекомендація OWASP для PBKDF2-HMAC-SHA256).
- **Тестування IndexedDB**: jsdom не має нативної реалізації IndexedDB — додається `fake-indexeddb` як devDependency (лише для тестів, не в продакшн-бандл).
- **Мнемоніка**: пряме кодування сирих pkcs8-байт приватного ключа як BIP39-подібний word list (не детермінована деривація — D8). Потрібен офіційний список 2048 англійських слів BIP39 (публічний домен, широко перевірений) як статичний дата-файл.

## Секція 1: IndexedDB-обгортка (загальне зашифроване сховище)

- [x] **Tests**: `client/tests/db.test.js` (з `fake-indexeddb`), 11 тестів — відкриття БД створює потрібні object stores; `put`/`get` round-trip для довільного значення (включно з перезаписом); `get` неіснуючого ключа повертає `undefined`; `remove` видаляє запис (і є no-op для неіснуючого); `listKeys` повертає всі ключі стору; відхилення при невідомому store; **реальна abort-після-success гонка** для `get` і `listKeys` (форсована через monkey-patch `IDBTransaction.prototype.objectStore`, підтверджена RED на старій реалізації).
- [x] **Impl**: `client/js/db.js` — тонка Promise-обгортка над IndexedDB (`openDatabase`, `put`, `get`, `remove`, `listKeys`), object stores: `profile`, `contacts`, `messages`. Усі мутуючі й читальні операції резолвляться через `tx.oncomplete`/`tx.onabort`, не `request.onsuccess` — захист від гонки "запит успішний, транзакція пізніше абортувала".
- [x] **Exec review**: 3 ітерації (гранична кількість), конвергенція — [iter1](../reviews/phase2-section-1-indexeddb-iter1.md), [iter2](../reviews/phase2-section-1-indexeddb-iter2.md), [iter3](../reviews/phase2-section-1-indexeddb-iter3.md). Ітерація 2 спростувала припущення ітерації 1, що abort-гонку неможливо практично протестувати — довела зворотне проб-скриптом і змусила додати справжній RED→GREEN тест.

## Секція 2: Passphrase-шифрування сховища (vault)

- [x] **Tests**: `client/tests/vault.test.js`, 7 тестів — `deriveVaultKey(passphrase, salt)` детермінований для тих самих вхідних даних (доведено через cross-key encrypt/decrypt interop, бо ключі `extractable: false`), різний для різних passphrase/salt; `encryptForVault`/`decryptForVault` round-trip довільних байтів (включно з не-ASCII); свіжий IV на кожен виклик; невірний passphrase при розшифровці кидає помилку (GCM auth failure), не повертає сміття; підроблений ciphertext відхиляється.
- [x] **Impl**: `client/js/vault.js` — `generateSalt` (16 байт), `deriveVaultKey` (PBKDF2-HMAC-SHA256, 600k ітерацій — актуальна межа OWASP 2023+), `encryptForVault`/`decryptForVault` (той самий формат `iv||ciphertext` і `bytesToBase64`/`base64ToBytes`, що й [e2ee.js](../../client/js/e2ee.js), без крос-контамінації з session-key механізмом E2EE — лише перевикористання чистих codec-функцій).
- [x] **Exec review**: 1 ітерація, конвергенція без потреби змін логіки — [iter1](../reviews/phase2-section-2-vault-iter1.md). Персистентність солі — свідомо поза межами цієї секції, відповідальність Секції 3 (генерувати раз, зберігати поруч із зашифрованим сховищем, перевикористовувати при кожному завантаженні — інакше кожне "розблокування" виводило б інший ключ і завжди провалювалось би, невідрізненно від невірного passphrase).

## Секція 3: Модель профілю (створення/завантаження перманентного профілю)

- [x] **Tests**: `client/tests/profile.test.js`, 7 тестів — `createPermanentProfile(passphrase)` генерує identity-keypair (`extractable: true`), зберігає зашифрований приватний ключ **і сіль** у `db`; `loadPermanentProfile(passphrase)` відновлює той самий keypair (sign/verify крос-перевірка з оригінальним), **перевикористовуючи збережену сіль** (два послідовні `loadPermanentProfile` успішні); невірний passphrase → `IncorrectPassphraseError`; відсутній профіль → `NoStoredProfileError`.
- [x] **Impl**: `client/js/profile.js` — `createPermanentProfile`, `loadPermanentProfile`, `hasStoredProfile()`, `IncorrectPassphraseError`, `NoStoredProfileError`. Публічний ключ при відновленні реконструюється через `derivePublicKeyFromPrivate` (нова функція в `identity.js` — сирі байти зберігають лише приватний ключ, за D8).
  - **Побічно**: виявлено й закрито архітектурну прогалину — відновлення identity лише з сирих приватних байт не мало способу відтворити публічний ключ (Web Crypto не має "derive public from private"); вирішено через гарантію JWK-експорту (RFC 7518 §6.2.2 зобов'язує включати x/y поряд із `d`).
  - **Достроково закрито пункт із Секції 5**: поріг "третій споживач codec" вже досягнутий — `bytesToBase64`/`base64ToBytes` винесено в `client/js/codec.js`, усі споживачі (`e2ee.js`, `identity.js`, `googleOAuth.js`, `vault.js`, `profile.js`) оновлені.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/phase2-section-3-profile-iter1.md), [iter2](../reviews/phase2-section-3-profile-iter2.md). Окремо: `derivePublicKeyFromPrivate` review — [iter1](../reviews/identity-derive-public-key-iter1.md).

## Секція 4: Backup — мнемоніка (BIP39-подібне кодування)

- [x] **Tests**: `client/tests/mnemonic.test.js` (8 тестів, включно з known-answer вектором, згенерованим незалежно через реальний пакет `bip39` перед його видаленням) + `client/tests/bip39-wordlist.test.js` (4 тести цілісності самого списку) — `bytesToMnemonic(bytes)` для 32-байтного входу повертає 24 слова зі списку BIP39, збігається з еталонним вектором; `mnemonicToBytes(words)` — точний round-trip; невірна довжина/контрольна сума/слово поза списком — чіткі помилки, не мовчазне пошкодження даних.
- [x] **Impl**: `client/js/mnemonic.js` — `bytesToMnemonic`/`mnemonicToBytes` (SHA-256 checksum за специфікацією BIP39), `client/js/bip39-wordlist-en.js` — офіційний список 2048 слів (згенеровано з тимчасово встановленого npm-пакета `bip39`, без рантайм-залежності від нього).
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/phase2-section-4-mnemonic-iter1.md), [iter2](../reviews/phase2-section-4-mnemonic-iter2.md).

## Секція 5: Backup — keyfile

- [x] **Tests**: `client/tests/keyfile.test.js`, 7 тестів — `createKeyfile(rawKeyBytes, passphrase)` повертає JSON-серіалізовну структуру `{version, salt, ciphertext}` зі свіжою сіллю/IV на кожен виклик; `restoreFromKeyfile` — точний round-trip сирих байтів, переживає реальний `JSON.stringify`/`parse`; невірний passphrase → `IncorrectKeyfilePassphraseError`; невідома версія/відсутні поля/невалідний base64 у солі → чітка "malformed keyfile" помилка (не сирий виняток).
- [x] **Impl**: `client/js/keyfile.js` — перевикористовує `vault.js` для шифрування й `client/js/codec.js` для base64. Окремий клас помилки `IncorrectKeyfilePassphraseError` (не `profile.js`'s) — свідомо, щоб уникнути циклічного імпорту напередодні Секції 6.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/phase2-section-5-keyfile-iter1.md), [iter2](../reviews/phase2-section-5-keyfile-iter2.md).
  - **Перенесено до Секції 6** (виконано): розглянути спільний `client/js/errors.js` для базового класу помилки невірного passphrase, коли `profile.js` і `keyfile.js` реально зійдуться в одному потоці відновлення.

## Секція 6: Відновлення профілю з backup

- [x] **Tests**: `client/tests/profile.test.js` (доповнення, 4 тести) — `restoreProfileFromMnemonic(words, localPassphrase)` і `restoreProfileFromKeyfile(json, keyfilePassphrase, localPassphrase)` (сигнатура keyfile-варіанту уточнена: два незалежні секрети, а не один, як спочатку планувалось, — passphrase самого keyfile і passphrase локального сховища цього пристрою) відновлюють identity-keypair, здатний підписувати верифіковано (крос-перевірка з оригінальним ключем), і зберігають його в `db` так, що незалежний наступний `loadPermanentProfile(localPassphrase)` також успішний; невірний keyfile passphrase → `IncorrectPassphraseError`; невалідна мнемоніка пропагує власну помилку `mnemonic.js`, не підміняється passphrase-помилкою. Додатково `client/tests/identity.test.js` (доповнення, 2 тести) для нової пари `exportPrivateKeyScalar`/`importPrivateKeyFromScalar`.
- [x] **Impl**: `client/js/profile.js` (доповнення) — з'єднує Секції 3-5; спільні приватні хелпери `persistRawIdentity`/`reconstructKeyPairFromRaw`. `client/js/errors.js` (новий) — спільні `IncorrectPassphraseError`/`NoStoredProfileError`, перенесено з окремих класів у `profile.js` й `keyfile.js` (`keyfile.js` тепер ре-експортує з `errors.js`).
  - **Виявлена й закрита архітектурна прогалина**: мнемоніка (`mnemonic.js`) кодує лише 32-байтний сирий приватний скаляр, тоді як формат сховища `profile.js`/`keyfile.js` — повний pkcs8-експорт (~138 байт, з вбудованим публічним ключем). Пряма підстановка одного на місце іншого в `restoreProfileFromMnemonic` не працювала б (виявлено тестом, не здогадкою). Вирішено новою парою в `identity.js` — `exportPrivateKeyScalar`/`importPrivateKeyFromScalar`: ручна мінімальна ASN.1/DER-конструкція PKCS8-обгортки без вбудованого публічного ключа; емпірично підтверджено (Node), що `crypto.subtle.importKey('pkcs8', ...)` самостійно виводить x/y з приватного скаляра.
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/phase2-section-6-restore-iter1.md), [iter2](../reviews/phase2-section-6-restore-iter2.md).

## Секція 7: UI — створення профілю, вибір backup, перемикання ефемерний/перманентний

- [x] **Tests**: `client/tests/app.test.js` (доповнення, 8 тестів) — "Створити профіль" показує крок passphrase без побічних дій; порожній passphrase відхиляється; підтвердження викликає `createPermanentProfile`, показує fingerprint, відкриває backup-крок і очищує поле passphrase; мнемоніка кодує саме створений ключ (`exportPrivateKeyScalar` → `bytesToMnemonic`); keyfile створюється з реального ключа з окремим keyfile-passphrase; порожній keyfile-passphrase відхиляється; "Пропустити" ховає backup-крок і показує постійний банер-нагадування; ефемерний шлях (`btn-generate`) працює без змін і не показує профільний UI (регресійний guard).
- [x] **Impl**: `client/index.html`, `client/js/app.js` — розширення UI, не заміна ефемерного шляху (Фаза 1 лишається робочою). Секрети очищуються з DOM-полів після використання; усі нові обробники загорнуті в наявний `withBusyButton` (error boundary + re-entrancy guard).
- [x] **Exec review**: 1 ітерація, конвергенція без правок — [iter1](../reviews/phase2-section-7-profile-ui-iter1.md).

## Секція 8: Мультипристрій — device keypair та сертифікат

- [x] **Tests**: `client/tests/deviceLinking.test.js`, 9 тестів — `generateDeviceKeyPair()` — окремий від identity ECDSA P-256 keypair (два виклики → різні ключі); `signDeviceCertificate(identityPrivateKey, devicePublicKey, {validityMs, now})` — перевірюваний сертифікат `{devicePubkey, issuedAt, expiresAt, signature}`, переживає JSON round-trip; `verifyDeviceCertificate` відхиляє: підмінений devicePubkey, підроблені timestamps, протермінований (і приймає той самий за мить до expiry — доводить, що причина саме expiry), issuedAt у майбутньому за межами skew, підпис чужої identity, malformed-структури (повертає `false`, ніколи не кидає).
- [x] **Impl**: `client/js/deviceLinking.js` — `generateDeviceKeyPair`, `signDeviceCertificate`, `verifyDeviceCertificate`. Канонічний payload підпису `spirit-device-cert-v1|<devicePubkeyB64>|<issuedAt>|<expiresAt>` — доменний префікс проти крос-контекстного replay, `|`-розділювач ін'єктивний (не зустрічається ні в base64, ні в рядковій формі жодного JS-числа); verify — чистий предикат (peer-контрольований вхід не може викликати виняток); clock-skew 60с лише вперед для issuedAt (як у googleOAuth.js), без допуску на expiry.
- [x] **Exec review**: 1 ітерація, конвергенція без правок — [iter1](../reviews/phase2-section-8-device-cert-iter1.md). Перевірено: числові краї JS для ін'єктивності payload, прив'язку алгоритму, межі expiry/skew, never-throws, свідоме непарсення SPKI (відповідальність Секції 9), невакуумність forgery-тестів.

## Секція 9: Мультипристрій — flow приєднання пристрою (перевикористання P2P-інфраструктури)

- [x] **Tests**: `client/tests/deviceLinking.test.js` (доповнення, 7 тестів, реальна крипто + fake-indexeddb) — протокол request/grant/apply: JSON round-trip, прив'язка сертифіката до запитаного ключа, відхилення malformed request і непарсибельного SPKI (перевірка, свідомо відкладена з Секції 8), повний happy-path з незалежним `loadPermanentProfile` після adoption і відновленням контактів, відмова без персистенції для сертифіката чужого пристрою/підробленого/malformed grant. `client/tests/profile.test.js` (доповнення, 3 тести) — `exportRawIdentity(passphrase)`. `client/tests/app.test.js` (доповнення, 4 тести, моки) — обидва UI-флоу з перевіркою повного ланцюжка викликів і очищення passphrase-полів.
- [x] **Impl**: `client/js/deviceLinking.js` (доповнення) — `createLinkRequest`/`createLinkGrant`/`applyLinkGrant`; grant бере СИРІ байти identity (не CryptoKey — завантажений профіль non-extractable за дизайном Секції 3), тож прив'язка пристрою вимагає повторного введення passphrase; `applyLinkGrant` валідує все до першого запису (прив'язка до власного ключа + верифікація сертифіката). `client/js/profile.js` — нові `exportRawIdentity`/`adoptIdentity` (спільний приватний `decryptStoredRawIdentity`). `client/js/app.js` — витягнуто спільні `startInitiatorSession`/`startJoinerSession` (чат-поведінка незмінна), нові обробники `btn-link-device`/`btn-join-as-device` з опаковим випадковим senderKey для сигналінгу (не identity fingerprint). `client/index.html` — секція "Пристрої".
- [x] **Exec review**: 1 ітерація, конвергенція без правок — [iter1](../reviews/phase2-section-9-device-join-iter1.md).

## Секція 10: Мультипристрій — відкликання та синхронізація

- [ ] **Tests**: `client/tests/deviceLinking.test.js` (доповнення) — відкликання пристрою оновлює підписаний список дозволених device certificates, збільшує версію; контакти, що отримають оновлений список, відхиляють повідомлення від відкликаного сертифіката.
- [ ] **Impl**: `client/js/deviceLinking.js` (доповнення) — `revokeDevice`, керування версійним списком сертифікатів.
- [ ] **Exec review**: —

## Верифікація

Секції 1-8 — повністю test-first, без зовнішніх залежностей (як Фаза 1 Секції 1-5). Секції 9-10 (P2P-флоу мультипристрою) — юніт-тестовані з моками WebRTC/signaling (як Секція 4-5 Фази 1); реальна перевірка "два браузери, один профіль" — ручна верифікація користувачем, аналогічно до живого тесту Google OAuth.
