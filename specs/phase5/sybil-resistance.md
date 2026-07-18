# Спека: Sybil-стійкість через proof-of-work на create_invite (Секція P4)

Розширення бектрогу `specs/phase5/security-hardening.md`'s Секції P4 ("Sybil-стійкість"). Рішення узгоджене з користувачем 2026-07-18 через AskUserQuestion: **proof-of-work на `create_invite`**, а не лише суворіші дефолтні ліміти (які не вирішують саму Sybil-проблему — розподілена ботнет-ферма з багатьох IP все одно обходить per-IP `RateLimiter.php`, кожен IP отримує свіжу квоту).

## Контекст

`server/library/RateLimiter.php` вже реалізує per-IP ковзне вікно (`checkAndRecordRoomCreation`, дефолт `M=10` room-creations/год на IP). Це best-effort захист від одного зловмисника з обмеженою кількістю IP, але безсилий проти справжньої ботнет-ферми: N різних IP = N незалежних квот. `create_invite` — єдина дія, що фактично створює нову кімнату (`create_offer` вимагає вже існуючого `room_id` з `create_invite`), тож PoW саме на `create_invite` перекриває весь потік створення спаму-кімнат.

## Дизайн: stateless hashcash-подібний PoW, прив'язаний до часового вікна

Без зайвого round-trip (клієнт не запитує "виклик" окремим запитом — сумісно з філософією "signaling — один POST-ендпоінт", `docs/signaling-protocol.md`) і без порушення zero-database (D1): challenge детермінований з поточного часу, квантованого у вікна, а не з серверного секрету чи збереженого стану.

1. **Часове вікно**: `timeWindow = floor(unixTime / POW_WINDOW_SECONDS)`, рекомендовано `POW_WINDOW_SECONDS = 30`.
2. **Challenge-рядок**: `${timeWindow}:${sender_key}` — прив'язка до `sender_key` означає, що кожна "нова особа" (свіжий identity-ключ, як і генерує кожен реальний або симульований Sybil-акаунт) повинна розв'язати ВЛАСНИЙ PoW; той самий nonce не підходить для іншого `sender_key`.
3. **Розв'язок (клієнт)**: знайти `nonce` (випадковий рядок/число), для якого `SHA-256(challenge + ":" + nonce)` має щонайменше `POW_DIFFICULTY_BITS` провідних нульових бітів. Рекомендовано `POW_DIFFICULTY_BITS = 20` (≈2^20 ≈ 1M хешів у середньому; сучасний десктоп/телефон — типово <1с через Web Crypto `crypto.subtle.digest`, конфігуровано, підняти за потреби).
4. **Запит**: `create_invite` додає до тіла `{ "pow_timestamp": <unix-секунди, той самий, що дав timeWindow>, "pow_nonce": "<рядок>" }`.
5. **Перевірка (сервер)**:
   - Recompute `timeWindow` з `pow_timestamp`; перевірити `|serverNow - pow_timestamp| <= 2 * POW_WINDOW_SECONDS` (толерантність до дрейфу годинника й межі вікна) — інакше `400`.
   - Recompute хеш, перевірити складність (провідні нульові біти) — інакше `400`.
   - **Anti-replay**: перевірити, що трійка `(timeWindow, sender_key, nonce)` ще не використовувалась — файловий лічильник `pow_spent.json`, той самий патерн блокування/TTL, що й `RateLimiter.php`/`Storage.php` (запис живе лише поки не спливе `2 * POW_WINDOW_SECONDS`, потім природний GC). Без цього кроку розв'язаний PoW можна один раз обчислити і "відтворити" з тисяч різних IP протягом того самого вікна — саме той Sybil-обхід, що PoW має закривати. Той самий клас best-effort застереження, що й `RateLimiter.php` (можливі гонки на shared-хостингу з кількома PHP-воркерами без спільної пам'яті — прийнятно, не гірше за наявний rate-limiter).
   - Невдала перевірка PoW → `400 Bad Request` з чітким кодом помилки (не `429` — це не rate-limit, а невалідний/відсутній доказ роботи), НЕ рахується в per-IP rate-limit лічильник як "успішний" запит (щоб не давати додаткового способу вичерпати чужу квоту підробленими PoW-запитами — але сам факт запиту все одно проходить через `checkAndRecordRequest`, загальний ліміл, per `RateLimiter.php`'s "records regardless of outcome" філософію).

## Секція SR1: PoW крипто-ядро (клієнт + сервер, чисті функції)

- [ ] **Tests**: `client/tests/pow.test.js` (новий) — `solvePow(challenge, difficultyBits)` знаходить nonce, для якого перевірка проходить; `verifyPow(challenge, nonce, difficultyBits)` (той самий алгоритм, що і на сервері, для симетричного клієнтського самотесту й для юніт-тестів) коректно рахує провідні нульові біти на кількох відомих хеш-префіксах; заниження складності явно провалює перевірку. `server/verify/section_pow.php` (новий, live-verification harness за патерном `section9_rate_limiter.php`) — PHP-версія `verifyPow`/`isNonceSpent` дає ІДЕНТИЧНИЙ результат до JS-версії на тих самих тестових векторах (крос-мовна відповідність — найбільший ризик підступного бага: якщо PHP і JS по-різному рахують провідні нульові біти чи по-різному кодують рядок у байти перед SHA-256, легітимні клієнти будуть відхилятись).
- [ ] **Impl**: `client/js/pow.js` (`solvePow`, `verifyPow`, `buildPowChallenge(timeWindow, senderKey)` — чисті функції на Web Crypto `crypto.subtle.digest("SHA-256", ...)`), `server/library/Pow.php` (`verify(challengeString, nonce, difficultyBits): bool`, той самий алгоритм).
- [ ] **Exec review**: —

## Секція SR2: Інтеграція в `create_invite` (сервер) + автоматичне розв'язання (клієнт)

- [ ] **Tests**: `server/verify/section_pow_integration.php` — `create_invite` без PoW-полів чи з невалідним PoW → `400`; з валідним PoW → `success`; повторне використання тієї самої `(timeWindow, sender_key, nonce)` трійки протягом вікна → `400` (anti-replay); після спливання вікна стара трійка природно "забувається" (GC), але вона й так більше не пройде перевірку `pow_timestamp`-свіжості, тож повторний GC-тест не є критичним, лише перевірка на "файл не росте безмежно". `client/tests/app.test.js`/`signalingClient.test.js` — `createInvite()` автоматично розв'язує PoW ПЕРЕД відправкою запиту (мокає `solvePow`), UI показує статус "Розв'язання..." під час обчислення (може зайняти помітний час на слабкому пристрої).
- [ ] **Impl**: `server/library/SignalingController.php` (`create_invite`-гілка викликає `Pow::verify`), `server/config.php` (`POW_WINDOW_SECONDS`, `POW_DIFFICULTY_BITS`, конфігуровані константи, той самий патерн, що й `MAX_REQUESTS_PER_WINDOW`), `client/js/signalingClient.js`'s `createInvite()` (розв'язує PoW перед POST), `client/js/app.js` (статус-повідомлення на час розв'язання).
- [ ] **Exec review**: —

## Верифікація

SR1 (чисте крипто-ядро, клієнт+сервер симетрично) — безпечно почати без додаткових питань, той самий паттерн crypto-core-first. SR2 (реальна інтеграція в живий протокол) потребує live-перевірки на обох тестових хостах (реальний `create_invite` виклик через живий PHP-вузол, не лише PHPUnit-подібний verify-harness) — PHP-код виконується на сервері, а не в Browser pane sandbox, тож перевірка = реальний HTTP-запит з клієнта до задеплоєного `server/public/index.php` на kolomedi/kibr.

**Явний масштаб цієї секції**: PoW додає тертя лише на `create_invite` (створення НОВОЇ кімнати). Він НЕ захищає `create_offer`/`get_offer`/`submit_answer`/`check_answer` — вони і так вимагають вже існуючого валідного `room_id`+`invite_token`, здобутого через `create_invite`, тож Sybil-вигода від їх флуду без валідного інвайту відсутня (per-IP `RateLimiter.php`'s загальний ліміл лишається єдиним захистом там, як і зараз).
