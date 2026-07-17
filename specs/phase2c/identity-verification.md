# Спека: Опційна верифікація зовнішньої ідентичності (Фаза 2c)

Повний flow за [docs/identity-verification.md](../../docs/identity-verification.md): генерація/публікація/перевірка URL-доказів, proof-set (версіонований підписаний список, доставка через P2P-хендшейк, анти-replay монотонність — той самий патерн, що й device-list, Секція 13), періодична переперевірка справжнім таймером у вкладці, бейджі в UI, явне відкликання.

Серверна частина (`fetch_proof` SSRF-захищена proxy-дія — `server/library/SignalingController.php::handleFetchProof`, приймає `{action:"fetch_proof", sender_key, target_url}`, повертає `{body, content_type}` або помилку) вже реалізована й задеплоєна раніше; ця спека — виключно клієнтська частина.

## Рішення (узгоджено з користувачем)

1. **Повний обсяг за один захід**: генерація/публікація, proof-set (додавання/відкликання), P2P-доставка, перевірка (прямий fetch + `fetch_proof` fallback), бейджі, UI на екранах «Профіль» і «Контакти»/чат.
2. **Періодична переперевірка — справжній `setInterval` у вкладці** (не за кожним відкриттям екрана): старт при `initApp`, інтервал раз на добу, поки вкладка відкрита; природно доповнюється ручною кнопкою «Перевірити зараз» і перевіркою при кожному новому P2P-з'єднанні з контактом.
3. **`enable_proof_proxy` вмикається на kolomedi/kibr ПІСЛЯ готовності клієнта** (в кінці цього заходу, живий тест з реальним Telegram-доказом).

## Секція A: `client/js/proofs.js` — один proof-блок

- [x] **Tests**: `client/tests/proofs.test.js` (новий файл) — `createProofBlock(identityPrivateKey, identityPublicKey, fingerprint)` повертає текстовий блок з маркерами `BEGIN/END SPIRIT PROOF`, усіма полями (`version`, `identity`, `statement`, `timestamp`, `nonce`, `signature`) і валідним підписом; `parseProofBlock(text)` витягує блок регулярним виразом з довільного оточуючого тексту (пост/сторінка з іншим вмістом навколо), повертає `null` для тексту без блоку чи з пошкодженою структурою; `verifyProofBlock(parsedBlock, expectedIdentityPublicKey)` — валідний підпис + `identity`-поле збігається з очікуваним публічним ключем → `true`; підроблений/змінений після підпису блок, чужий `identity`, чи блок без потрібних полів → `false` (ніколи не кидає виняток — вміст сторінки контролює співрозмовник/зовнішня платформа).
- [x] **Impl**: `client/js/proofs.js` — той самий підхід до канонічного payload (`|`-роздільник, недвозначний, бо відсутній у base64/hex/decimal), що й `deviceLinking.js`/`identityAnnounce.js`.
- [x] **Exec review**: iter1 — [reviews/identity-verification-A-C-iter1.md](../reviews/identity-verification-A-C-iter1.md). Для Секції A реальних знахідок немає (неін'єктивність `statement`-поля проаналізована й визнана неексплуатовною).

## Секція B: `client/js/proofSet.js` — версіонований підписаний список

- [x] **Tests**: `client/tests/proofSet.test.js` (новий файл) — `signProofSet(identityPrivateKey, proofs, revoked, {version})` підписує `{version, proofs, revoked, signature}`; `verifyProofSet(identityPublicKey, proofSet)` — предикат, ніколи не кидає; `acceptNewerProofSet(identityPublicKey, current, incoming)` приймає `incoming` лише якщо валідний і `version` строго більший за `current` (та сама анти-replay монотонність, що й `acceptNewerDeviceList`); `addProofToSet(identityPrivateKey, currentSet, newProofEntry)` і `revokeProofFromSet(identityPrivateKey, currentSet, urlToRevoke)` — обидва інкрементують version і перепідписують; регресійний тест на ін'єктивність канонічного payload (exec review, п.1).
- [x] **Impl**: `client/js/proofSet.js`, структура один-в-один з `docs/identity-verification.md` (`{version, proofs: [{url, label, added_at}], revoked: [{url, revoked_at}], signature}`); канонічний payload — `JSON.stringify` фіксованої форми (НЕ `|`/`:`-роздільник — виявлена й виправлена колізія, exec review п.1).
- [x] **Exec review**: iter1 — [reviews/identity-verification-A-C-iter1.md](../reviews/identity-verification-A-C-iter1.md). 1 критична знахідка (неін'єктивний канонічний payload — колізія підпису через довільний текст у url/label) — виправлено переходом на `JSON.stringify`.

## Секція C: Доставка proof-set через P2P + зберігання в контакті

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — після верифікованого identity-announce з профілем-власником proof-set клієнт надсилає зашифроване `proof-set-announce` control-повідомлення (та сама послідовність, що й `device-list-announce` в `makeIdentityAnnouncer`); отримання `proof-set-announce` від верифікованого peer оновлює `contact.proofSet` через `acceptNewerProofSet` (старіша/невалідна версія — ігнорується); `client/tests/contacts.test.js` (доповнення) — `updateContactProofSet(fingerprint, proofSet)` зберігає без створення сирітського запису.
- [x] **Impl**: `client/js/app.js` (`CONTROL_MESSAGE_TYPES` += `"proof-set-announce"`, `handleChatMessage` дротування, надсилання власного proof-set поруч з device-list-announce), `client/js/contacts.js` (`updateContactProofSet`, поле `proofSet: null` у новому записі контакту).
- [x] **Exec review**: iter1 — [reviews/identity-verification-A-C-iter1.md](../reviews/identity-verification-A-C-iter1.md). Реальних знахідок для Секції C немає (дротування підтверджено побайтово симетричним до device-list-announce).

## Секція D: Перевірка URL — прямий fetch + `fetch_proof` fallback

- [x] **Tests**: `client/tests/fetchProof.test.js` (новий файл, fake `fetch`) — `fetchProofPageText(baseUrl, senderKey, url)` спочатку пробує прямий `fetch(url)`; при мережевій/CORS-помилці — фолбек на `signalingClient.js`-виклик дії `fetch_proof`; обидва шляхи повертають текст сторінки; обидва провали (прямий і proxy) → зрозуміла помилка, не крах; non-http(s) URL пропускає прямий fetch взагалі (exec review). `client/tests/signalingClient.test.js` (доповнення) — новий експорт `fetchProof(baseUrl, {senderKey, targetUrl})` мапить `{action:"fetch_proof", sender_key, target_url}` → `{body, contentType}`.
- [x] **Impl**: `client/js/signalingClient.js` (`fetchProof`), `client/js/fetchProof.js` (новий, оркеструє direct-then-proxy; `isFetchableDirectly` — гейт на схему `http:`/`https:` перед прямим fetch на недовірений URL, exec review).
- [x] **Exec review**: iter1 — [reviews/identity-verification-D-E-iter1.md](../reviews/identity-verification-D-E-iter1.md). 1 знахідка для Секції D (немає гейту на схему URL для прямого fetch недовіреного вхідного URL) — виправлено.

## Секція E: UI — публікація, бейджі, відкликання, періодична переперевірка

- [x] **Tests**: `client/tests/app.test.js` (доповнення) — «Профіль» → «Підтвердження акаунтів»: кнопка генерує/показує proof-блок для копіювання, поле URL + кнопка «Додати» викликає `fetchProofPageText`+`verifyProofBlock` (sanity-check власної публікації) перед додаванням у proof-set та збереженням; список власних доказів з кнопкою «Відкликати» на кожному; «Контакти» — бейдж `перевірено: <дата>` для кожного проходу перевірки чужого доказу з proof-set контакту, кнопка «Перевірити зараз»; кілька послідовних невдач → статус «не вдалося підтвердити востаннє: `<дата>`» (не миттєве зникнення бейджа); `setInterval`-таймер стартує раз при `initApp` (не дублюється при повторній ініціалізації, перевірено прямим підрахунком spy-викликів `setInterval`/`clearInterval`); регресійний тест на скидання власного proof-стану при зміні активного профілю в тій самій вкладці (exec review).
- [x] **Impl**: `client/index.html` (підрозділ «Підтвердження акаунтів» на екрані `profile`, бейджі на екрані `contacts`), `client/js/app.js` (обробники, `setInterval`, дедуп через маркер на `doc.defaultView`, `resetOwnProofsState()` — викликається при кожній зміні активного профілю в тій самій вкладці, exec review), `client/css/style.css` (`.proof-badge`), `client/js/i18n.js` (12 нових ключів × 11 локалей: `proofs.heading`, `btn.generateProof`, `btn.addProof`, `label.proofUrl`, `btn.revokeProof`, `proofs.needUrl`, `proofs.needGenerateFirst`, `proofs.sanityCheckFailed`, `proofs.verifiedAt`, `proofs.failedSince`, `btn.checkProofsNow`, `proofs.myProofs`).
- [x] **Exec review**: iter1 — [reviews/identity-verification-D-E-iter1.md](../reviews/identity-verification-D-E-iter1.md). 1 критична знахідка (стан власних доказів не скидався при перемиканні активного профілю в тій самій вкладці — витік/пошкодження даних між профілями) — виправлено.

## Верифікація

Test-first, jsdom + fake-indexeddb + fake `fetch`, як решта проєкту (375+ тестів, 2 раунди Opus exec-review, разом знайдено й виправлено 4 реальні дефекти: колізія підпису у canonical payload, витік стану доказів між профілями в одній вкладці, відсутній гейт на схему URL, помилковий шлях деплою секретів на сервері).

- [x] `ENABLE_PROOF_PROXY` увімкнено на kolomedi/kibr (`server/config.secrets.php` → `spirit/config.secrets.php`, FTP). Живо підтверджено curl-запитами: proxy успішно фетчить і звичайний сайт (`https://example.com/`), і реальний Telegram embed (`https://t.me/spiritid/1?embed=1`, обхід CORS-блоку підтверджено — тіло сторінки отримано через сервер).
- [x] **Повний живий E2E з реальним опублікованим доказом** — виконано 2026-07-17. За прямим дозволом користувача, замість стороннього GitHub Gist, proof-блок опубліковано на власній інфраструктурі проєкту: `https://spirit.kolo.media/spiritid/spirit9a2a2dff.txt` і дзеркально `https://spirit.kibr.com.ua/spiritid/spirit9a2a2dff.txt` (звичайний статичний файл поза `client`/`server`, задеплоєний по FTP окремим кроком). Повний цикл підтверджено живо на `spirit.kolo.media`:
  1. Згенеровано proof-блок в ефемерній сесії (екран «Профіль» → «Створити доказ»).
  2. Додано URL — sanity-check (`fetchProofPageText` + `verifyProofBlock`) пройшов, блок з'явився в «Мої докази» з кнопкою «Відкликати».
  3. P2P-обмін з окремою вкладкою на ПОСТІЙНОМУ профілі (proof-set доставляється лише для збережених контактів, не ефемерних) — після identity-announce автоматично прийшов `proof-set-announce`, у «Контакти» з'явився бейдж `spirit.kolo.media`.
  4. Кнопка «Перевірити зараз» — бейдж оновився до `перевірено: 17.07.2026, 20:44:32` (реальний `fetch_proof`-прохід підтверджено).
  5. Відкликання на боці власника (`own-proofs-list` спорожнів після кліку «Відкликати»).
  6. Перевірено, що відкликання НЕ поширюється миттєво (проміжна повторна перевірка з тим самим локальним proof-set все ще показувала старий бейдж — очікувано, той самий патерн, що й device-list, синхронізація лише на новому P2P-рукостисканні).
  7. Нове P2P-з'єднання (свіжий invite, той самий контакт) → оновлений proof-set доставлено → бейдж зник із «Контакти». Відкликання підтверджено коректно поширеним.
