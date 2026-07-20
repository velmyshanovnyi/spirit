# Спека: Опційний імпорт контактів/історії (Фаза 2b)

Архітектурні хуки вже задокументовані в [docs/migration.md](../../docs/migration.md) — ця спека переводить їх у Tests/Impl/Exec-review трійки. Не блокує жодну іншу фазу (явно позначено опційним з самого початку).

## Ключові рішення (уже зафіксовані в migration.md, не потребують AskUserQuestion)

1. **Немає автоматичного зіставлення особи** — імпортований контакт зберігається як "очікує на верифікацію", без Spirit identity pubkey. Прив'язка до реального Spirit-контакту — виключно РУЧНА дія користувача (вибір із наявного списку `listContacts()`), ніколи автоматична за збігом імені/номера (свідомо повільніше, щоб не створити механізм деанонімізації).
2. **Окреме сховище для "pending" імпортів** — НЕ поле в `contacts.js` (той стор ключується `fingerprint`, якого в імпортованого запису ще нема). Новий IndexedDB-стор `importedContacts`: `{ id, displayName, sourceIdentifier, source, importedAt, matchedFingerprint: null }`.
3. **Історія прив'язується лише після матчингу** — розпарсені повідомлення з файлу експорту тримаються в `importedContacts`-подібному pending-стані (чи окремому `importedMessages`-сховищі, keyed тим самим `id` до матчингу), і лише після ручного підтвердження користувачем ("це той самий Іван") переносяться/записуються в `historyStore.js` під РЕАЛЬНИЙ `fingerprint`, з міткою `imported: true` в самому записі повідомлення (`historyStore.js`'s зашифрований payload вже довільний JSON, поле `imported`/`historical` додається туди без зміни схеми сховища).
4. **UI-мітка "історичне (імпортоване)"** на кожному імпортованому повідомленні в чат-лозі — відрізняється візуально від нативних P2P-повідомлень (не пройшло через E2EE-хендшейк, локальна копія тексту без криптографічної гарантії автентичності).
5. **Формати**: контакти — Telegram JSON export, vCard (`.vcf`), WhatsApp contacts export. Історія — Telegram JSON export, WhatsApp `.txt` export.

## Секція I1: Чисті парсери (без UI/DOM/IndexedDB)

Той самий підхід, що вже виправдав себе для shamir.js/fileTransfer.js/pow.js: спочатку самодостатній, повністю протестований модуль чистих функцій, окремий exec review, лише ПОТІМ — UI-інтеграція.

```ts
parseContactList(fileText: string, format: "telegram-json" | "vcard" | "whatsapp"): { displayName: string; sourceIdentifier: string }[]
parseChatExport(fileText: string, format: "telegram-json" | "whatsapp-txt"): { timestamp: number; sender: string; text: string }[]
```

(Сигнатура з `migration.md` бере `File`, тут — `fileText: string`, оскільки читання файлу (`File.text()`) — DOM-залежна, асинхронна операція; чисті парсери приймають уже прочитаний текст, читання файлу — тонка UI-обгортка в Секції I2.)

- [x] **Tests**: `client/tests/importParsers.test.js` — по кожному формату: коректний парсинг реалістичного зразка (невеликий, вручну складений приклад формату, не справжній експорт з чужих даних), порожній файл → порожній масив (не помилка), пошкоджений/невалідний вхід → чітка помилка (не мовчазне порожнє повторення чи crash), Unicode-імена/текст (кирилиця, емодзі) не спотворюються, WhatsApp `.txt` коректно розділяє мультирядкові повідомлення від нових записів (найбільший ризик парсингу тексту — багаторядкові повідомлення виглядають як кілька окремих рядків).
- [x] **Impl**: `client/js/importParsers.js` — чисті функції, без залежності від `app.js`/DOM/IndexedDB.
- [x] **Exec review**: `specs/reviews/import-I1-iter1.md` — converged iter1, 2 test-coverage gaps fixed (vCard FN-without-TEL/EMAIL, Telegram contact without phone_number/user_id), no impl changes needed.

## Секція I2: Імпорт контактів — UI, pending-сховище, ручний матчинг

- [x] **Tests**: `client/tests/importedContacts.test.js` (CRUD pending-стору, 8 тестів), `client/tests/app.test.js` (завантаження файлу → парсинг → рендер pending-списку; ручний вибір "зіставити з контактом X" встановлює `matchedFingerprint`; контакт без матчингу лишається "очікує" необмежено довго, не зникає; видалення; рендер матчед-запису — 5 тестів у describe "contact import UI (Section I2, specs/phase2b/import.md)").
- [x] **Impl**: `client/js/importedContacts.js` (новий стор, мірорить стиль `contacts.js`/`groups.js`), `client/js/db.js` (DB_VERSION 3 -> 4, ідемпотентний upgrade), UI на екрані «Контакти» (`client/index.html` -- `#import-card`: вибір формату через `<select>` -- явний вибір користувача, бо WhatsApp-контакти повторно використовують vCard-парсер, тож sniffing за розширенням файлу був би неоднозначним; `client/js/app.js` -- `renderImportedContactsScreen`, файл-інпут-обробник, delegated click для Match/Delete).
- [x] **Exec review**: `specs/reviews/import-I2-iter1.md` — converged iter1, no findings (anti-auto-match, unmatched-persistence, DB-version idempotency, XSS-safety all confirmed clean).

## Секція I3: Імпорт історії — прив'язка до матчингу, мітка "історичне"

Рішення щодо UI-флоу (I3, зафіксовано за судженням агента, без додаткового AskUserQuestion — суто UX-деталь, не архітектурний інваріант): для `telegram-json` той самий вибраний файл прогонається і через `parseContactList` (контакти, як у I2), і через `parseChatExport` (історія) — якщо `parseChatExport` кидає помилку (файл контактів без `messages`), це очікувано й тихо ігнорується, успішний імпорт контактів не скасовується. Оскільки `parseChatExport` не повертає назву чату/контакту, історія зберігається як ОКРЕМИЙ pending-запис (`source: "telegram-json-history"`) із displayName, підібраним героистично (перший `sender`, що не збігається з власним нікнеймом профілю). Для `whatsapp-txt` (новий формат у `<select>`, лише історія — WhatsApp `.txt` не несе структурованого списку контактів) — та ж логіка, без спроби `parseContactList`.

Розпарсені повідомлення тримаються в новому полі `pendingMessages` того ж запису `importedContacts` (не окремий стор) і НІКОЛИ не записуються в `historyStore.js`, доки користувач не підтвердить matching (`setMatchedFingerprint`) — саме тоді, і лише тоді, викликається `appendMessage(..., { ..., imported: true })` для кожного повідомлення, після чого `clearPendingMessages` очищує `pendingMessages` (щоб повторний рендер не переписав історію вдруге). `historyStore.js`'s `appendMessage` змінено серіалізувати весь payload-об'єкт (а не лише 3 названі поля) — це дозволяє полю `imported` (і будь-якому іншому додатковому полю) проїхати крізь шифрування без зміни схеми стору, як і задумано.

Напрямок (`direction`) імпортованого повідомлення визначається евристикою `inferImportedDirection`: порівняння `sender` з власним нікнеймом активного профілю (без урахування регістру/пробілів), інакше — `"in"`. Це задокументована евристика, не криптографічна гарантія автентичності (імпортовані повідомлення НЕ проходили через E2EE-хендшейк цього застосунку).

Візуальна мітка "історичне (імпортоване)" рендериться в `appendChat` (1:1 чат-лог) через префікс-бейдж, коли `entry.imported === true`; це стосується лише шляху `listMessages` → рендер при відкритті розмови (свіжий матчинг сам по собі не рендерить messages одразу в живий чат-лог — вони з'являться при наступному відкритті розмови з цим контактом).

Крайовий випадок, знайдений і виправлений на exec review iter1: підтвердження матчингу в ефемерному режимі (без vault key) без цієї обробки тихо "втрачало" б `pendingMessages` (Match-кнопка зникає з рендеру одразу після успішного `setMatchedFingerprint`, а без vault key `historyStore.js` ніколи не пишеться). Виправлено: у такому випадку показується `import.ephemeralHistorySkipped` замість мовчазної втрати.

- [x] **Tests**: `client/tests/importedContacts.test.js` (`pendingMessages` на `saveImportedContact`, `clearPendingMessages` — 4 тести), `client/tests/historyStore.test.js` (`imported: true` переживає шифрування/дешифрування без зміни схеми), `client/tests/app.test.js` (whatsapp-txt викликає лише `parseChatExport`; telegram-json додатково намагається `parseChatExport` на тому ж файлі й створює sibling pending-запис; контакти-лише telegram-json (parseChatExport кидає) все одно успішно імпортує контакти; без матчингу `appendMessage` не викликається; після матчингу `appendMessage` викликається з `imported: true` під реальним fingerprint і `clearPendingMessages` викликається; ефемерний режим без vault key показує попередження замість мовчазної втрати; рендер чат-лога показує бейдж для `imported`, не показує для нативних — 7 нових тестів).
- [x] **Impl**: `client/js/importedContacts.js` (`pendingMessages` поле на `saveImportedContact`, `clearPendingMessages`), `client/js/historyStore.js` (`appendMessage` серіалізує весь payload, не лише 3 названі поля), `client/js/app.js` (файл-інпут-обробник тепер також намагається `parseChatExport`; delegated Match-клік записує `pendingMessages` у `historyStore.js` й очищує їх; `appendChat` приймає `imported`-прапорець і рендерить бейдж; `deriveImportedHistoryDisplayName`/`inferImportedDirection` — задокументовані евристики), `client/index.html` (новий option `whatsapp-txt` у `#import-format`), `client/js/i18n.js` (5 нових ключів у всіх 11 локалях).
- [x] **Exec review**: `specs/reviews/import-I3-iter1.md` — 1 реальна знахідка (ефемерний-режим stranded pendingMessages), виправлено (`import.ephemeralHistorySkipped` попередження); решта (impossible-early-write, imported-tag survival через шифрування, direction-heuristic документація, badge-рендер у всіх шляхах) підтверджено чистими. Converged iter1.

## Верифікація

I1 (чисті парсери) — безпечно почати без додаткових питань, той самий паттерн parser/crypto-core-first. I2/I3 (UI, ручний матчинг, запис в historyStore) — реальна інтеграція, потребує живої перевірки завантаження реального файлу експорту через UI в браузері (не лише unit-тестів з вручну складеними зразками).
