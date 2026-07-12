# Спека: Крос-серверні (портативні) акаунти через детерміновану деривацію ключа

Заміна моделі "випадковий ключ + локально зашифрований блок" на детерміновану: `identity keypair = KDF(пароль, сіль=ім'я)`. Дозволяє увійти в один і той самий акаунт на будь-якому Spirit-вузлі (незалежному, автономному, що нічого не знає про інші вузли) без жодного локального сховища — лише логін+пароль.

## Формат

```
Логін:  spirit + ІМ'Я(10 символів) + ХВІСТ(16 символів)   = 32 символи, публічний (сам Spirit ID)
Пароль: окремо, не входить у публічний рядок
```

## Рішення (узгоджено з користувачем)

1. **Один виклик Argon2id, 64-байтний вивід, два domain-розділені похідні значення**: `Argon2id(password, salt=ІМ'Я, iterations=3, memorySize=131072 KiB (128 MiB), parallelism=1, hashLength=64 bytes)`. Байти 0–31 → приватний scalar identity-ключа (той самий шлях, що вже є в `mnemonic.js`, `importPrivateKeyFromScalar`). Байти 32–63 → base64url, перші 16 символів → публічний хвіст-верифікатор логіна. **Критично**: хвіст ніколи не дорівнює/не виводиться з приватного scalar-у напряму — це один потік Argon2id-виводу, розділений на непересічні сегменти.
2. **KDF**: Argon2id через `hash-wasm` (WASM, самодостатній ESM-файл, весь WASM inline base64 — сумісний із деплоєм без bundler, копіюється як vendored-файл, не через `node_modules`/npm-резолюцію в браузері). Свідомий виняток із правила "нуль зовнішніх крипто-залежностей" (`docs/decisions.md`) — Argon2id неможливо реалізувати нативним Web Crypto API.
3. **Параметри** (m=128 MiB, t=3, p=1) обрані так, щоб один виклик займав ~0.5–1.5с на мобільному браузері (прийнятний UX при вході), і водночас робив паралелізацію на GPU/ASIC-фермах на 2-3 порядки дорожчою, ніж для PBKDF2/SHA — memory-hardness Argon2id обмежує кількість паралельних інстансів фізичним обсягом VRAM.
4. **Пароль**: за замовчуванням пропонується згенерований (6+ випадкових слів, ~65+ біт ентропії — той самий рівень, що вже дає мнемонік-бекап 24 слова, тут коротше бо це не seed для 256-біт ключа напряму, а KDF-вхід), користувач може замінити на власний.
5. **Наявні тестові акаунти можна не мігрувати** — це новий, паралельний шлях створення акаунта; стара модель (`profile.js`, локально зашифрований блок) лишається без змін для тих, хто вже нею користується.

## Секція H1: Argon2id-деривація (ядро)

- [x] **Tests**: `client/tests/deterministicIdentity.test.js` (новий файл) — `deriveAccountMaterial(name, password)` повертає `{ privateKeyScalar: Uint8Array(32), verifierTail: string(16) }`; той самий `(name, password)` завжди дає той самий результат (детермінізм); інший пароль чи інше ім'я дають інший результат; `verifierTail` складається лише з base64url-безпечних символів; regression-тест на переплутані byte-ranges (не повний доказ крипто-незалежності — це визнано в exec review).
- [x] **Impl**: `client/js/vendor/hash-wasm.esm.js` (скопійований `dist/index.esm.js` з npm-пакету `hash-wasm`, self-contained ESM, весь WASM inline base64), `client/js/deterministicIdentity.js` (`deriveAccountMaterial`, фіксовані Argon2id-параметри як константи).
- [x] **Exec review**: iter1 — [reviews/deterministic-accounts-H1-H2-iter1.md](../reviews/deterministic-accounts-H1-H2-iter1.md). Domain separation між `privateKeyScalar`/`verifierTail` підтверджено безпечною (один Blake2b-512 виклик для hashLength≤64). 1 LOW-знахідка (невалідний P-256 scalar не перевіряється, ~2⁻³² шанс) — свідомо прийнято й задокументовано в коді, той самий клас edge-case вже є в `mnemonic.js`.

## Секція H2: Генератор пароля (6+ слів)

- [x] **Tests**: `client/tests/passwordGenerator.test.js` (новий файл) — `generateStrongPassword()` повертає рядок із 6 слів, розділених пробілом, з фіксованого словника; повторні виклики дають різні результати (базова перевірка випадковості).
- [x] **Impl**: `client/js/passwordGenerator.js` — перевикористовує наявний `BIP39_ENGLISH_WORDLIST` (той самий, що й `mnemonic.js`, 2048 слів), `crypto.getRandomValues`-базований вибір, без checksum (на відміну від 24-слівної seed-фрази — це вхід для KDF, не пряме кодування ключа).
- [x] **Exec review**: iter1 — [reviews/deterministic-accounts-H1-H2-iter1.md](../reviews/deterministic-accounts-H1-H2-iter1.md). Нульовий modulo-bias (2048=2¹¹ ділить 2³² націло). Реальних знахідок немає.

## Секція H3: Створення портативного акаунта (UI)

Реалізовано як ДОДАТКОВА опція (чекбокс `#portable-account-checkbox` на наявній формі створення), а не заміна — наявний `createPermanentProfile`-шлях (сотні наявних тестів по всьому проєкту) лишився повністю без змін, коли чекбокс unchecked (за замовчуванням).

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — за замовчуванням (unchecked) не викликає `deriveAccountMaterial`/`adoptScalarIdentity` (регресія-guard); checked → генерує ім'я, деривує, `adoptScalarIdentity`, показує повний логін `spirit<ім'я><хвіст>` у `#portable-login-display`; чекбокс автозаповнює поле паролю згенерованим (не перезаписуючи вже введений).
- [x] **Impl**: `client/index.html` (чекбокс + `#portable-login-display`), `client/js/app.js` (`btn-profile-confirm` розгалужується за станом чекбокса; `change`-обробник чекбокса), `client/js/i18n.js`, `client/css/style.css` (`.checkbox-field`).
- [x] **Exec review**: iter1 — [reviews/deterministic-accounts-H3-H4-iter1.md](../reviews/deterministic-accounts-H3-H4-iter1.md). Реальних знахідок для Секції H3 немає (перезапис локального акаунта А неможливий — різні `profileId`).

## Секція H4: Крос-серверний вхід (UI)

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — введення повного логіна (32 символи) + пароль на БУДЬ-ЯКОМУ вузлі (без попереднього `listProfiles()`-запису для цього логіна) відтворює той самий keypair, звіряє хвіст локально (обчислений заново, без мережевого запиту), показує зрозумілу помилку при невідповідності хвоста чи невалідному форматі логіна; завантажує власний нікнейм і записує сесію/MRU (виправлено в exec review).
- [x] **Impl**: `client/index.html` (`#portable-login-form`, завжди доступна незалежно від наявності локальних профілів), `client/js/app.js` (`btn-login-portable`, regex-парсинг `spirit<name10><tail16>`).
- [x] **Exec review**: iter1 — [reviews/deterministic-accounts-H3-H4-iter1.md](../reviews/deterministic-accounts-H3-H4-iter1.md). 2 знахідки (застарілий нік не завантажувався; відсутня сесія/MRU-фіксація) — обидві виправлено.

## Верифікація

Test-first, jsdom (WASM working у jsdom через Node's WebAssembly support). Фінал: жива перевірка — створити акаунт на одному хості, увійти тим самим логіном+паролем на іншому (spirit.kolo.media ↔ spirit.kibr.com.ua), підтвердити ідентичний Spirit ID.
