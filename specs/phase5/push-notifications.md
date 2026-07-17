# Спека: Encrypted push notifications (Секція P3)

Розширення `specs/phase5/security-hardening.md`'s Секції P3 — рішення узгоджені з користувачем 2026-07-18 через AskUserQuestion (модель довіри, обмеження зберігання підписки, коло одержувачів).

## Рішення (узгоджено з користувачем)

1. **Web Push API прийнятий як компроміс**: push-сервіс браузера (Google FCM / Mozilla autopush) бачить метадані (коли, на яку адресу), НЕ бачить вміст (payload шифрується під ключі підписки, RFC 8291). Той самий компроміс, що й у Signal/більшості E2EE-месенджерів із push.
2. **Підписка НІКОЛИ не потрапляє на сервер Spirit** — ділиться виключно P2P між уже верифікованими контактами (той самий канал і патерн, що й `device-list-announce`/`proof-set-announce`). Сигнальний вузол push-підписку не бачить і не зберігає — нуль відступу від zero-database (D1), бо взагалі відсутнє на сервері.
3. **Лише для збережених верифікованих контактів** (постійний профіль з обох боків) — ефемерні "духи" не мають постійного профілю, куди прив'язати підписку; push для них архітектурно безглуздий (нема чого відновлювати після закриття вкладки).

## Архітектурний наслідок: що ФАКТИЧНО може push, а що ні

Zero-database (D1) лишається непорушним: сервер ніколи не зберігає повідомлення для офлайн-одержувача. Це означає push НЕ доставляє пропущені повідомлення — технічно неможливо без порушення D1. Реальна, чесна семантика: **push = "дзвінок у двері"**, не "поштова скринька". Sender, намагаючись писати офлайн-контакту, замість (чи на додачу до) звичайного запрошення відправляє push НАПРЯМУ у push-сервіс одержувача (без участі сервера Spirit) із корисним навантаженням — тим самим invite-посиланням (room+token), яке одержувач і так отримав би поза каналом. Service Worker одержувача показує системне сповіщення; клік відкриває Spirit із `?room=&token=` — той самий вже наявний zero-click auto-join (Секція F4), без жодної нової логіки прийому.

Це узгоджується з поточною моделлю "обидва учасники мають бути одночасно онлайн для реального обміну" — push лише підвищує шанс, що одержувач це помітить і відкриє вкладку вчасно, поки відправник ще чекає.

## VAPID (ідентифікація "застосунку" для push-сервісу)

Web Push вимагає VAPID-підпис (ES256 JWT) від "application server" — але в Spirit немає серверного застосунку, лише клієнти. Рішення: **один спільний, вбудований у клієнтський код VAPID keypair** (публічний І приватний ключ обидва в `client/js/`, оскільки немає серверного секрету, який треба ховати — VAPID тут лише про rate-limiting/ідентифікацію на рівні push-провайдера, НЕ про E2E-безпеку payload, яка вже забезпечена окремими ключами підписки одержувача). Наслідок: теоретично будь-який Spirit-клієнт може слати push будь-якому Spirit-підписнику (VAPID не є секретом) — узгоджується із загальною моделлю "без центральної довіри", той самий клас компромісу, що й D3.

## Секція PN1: Web Push payload-шифрування (чисте крипто-ядро, RFC 8291)

Той самий підхід, що вже виправдав себе для ratchet.js/deterministicIdentity.js: спочатку самодостатній, повністю протестований крипто-модуль, окремий exec review, і лише ПОТІМ (наступні секції) — Service Worker, UI, інтеграція.

- [x] **Tests**: `client/tests/webPushCrypto.test.js` (новий файл, 7 тестів) — базовий round-trip; round-trip реального payload-формату `{room, token}`; порожній plaintext; свіжий ефемерний ключ+сіль на кожен виклик (недетермінізм); точна структура заголовка RFC 8188 (`salt(16)/recordSize(4 BE)/idLen(1)/keyId`); відмова розшифрування з чужим keypair; відмова розшифрування з чужим auth secret. 470/470 по проєкту.
- [x] **Impl**: `client/js/webPushCrypto.js` — `encryptWebPushPayload`/`decryptWebPushPayload` (друга — лише для тестового round-trip, реальний Service Worker використовує вбудований `PushEvent.data`), чиста крипто-логіка на Web Crypto API (ECDH P-256, HKDF, AES-128-GCM) без вендорингу — жодних зовнішніх крипто-бібліотек не знадобилось.
- [x] **Exec review**: iter1 — [reviews/push-notifications-PN1-iter1.md](../reviews/push-notifications-PN1-iter1.md). Нуль знахідок, збіжність з першої ітерації. Залишковий ризик (не дефект): повна сумісність з РЕАЛЬНИМ декодером push у браузері підтверджена лише читанням коду проти специфікації й round-trip-тестами проти власного ж decrypt — зовнішня крос-перевірка (Node `web-push` чи реальний `PushSubscription`) записана як обов'язковий крок ПЕРЕД завершенням Секції PN5 (фактичне надсилання).

## Секція PN2: VAPID JWT-підпис

- [x] **Tests**: `client/tests/vapid.test.js` (5 тестів) — форма JWT/header/payload; підпис проходить перевірку відповідним публічним ключем; підпис НЕ проходить перевірку чужим ключем (доказ прив'язки); `exp` за замовчуванням ≤ now+24год; явний `ttlSeconds` враховується і теж обмежений 24год. 475/475 по проєкту.
- [x] **Impl**: `client/js/vapid.js` (`signVapidJwt`, перевикористовує `bytesToBase64Url` з `webPushCrypto.js`), `client/js/vapidKeys.js` (згенерований одноразовим Node-скриптом ES256 keypair — публічний JWK, приватний JWK, публічний ключ у raw base64url для `applicationServerKey`).
- [x] **Exec review**: iter1 — [reviews/push-notifications-PN2-iter1.md](../reviews/push-notifications-PN2-iter1.md). Нуль знахідок; узгодженість ключів (raw↔JWK, приватний↔публічний) перевірена реальним виконанням коду, не лише читанням.

## Секція PN3: Service Worker — реєстрація, підписка, показ сповіщення

- [x] **Tests**: `client/tests/sw.test.js` (13 тестів) — чиста логіка винесена в експортовані функції, тестовані напряму в jsdom (реальні `PushEvent`/`Clients` API там недоступні, тому сам `self.addEventListener`-дротування — untestable-by-design runtime glue, позначена `/* c8 ignore */`): `parsePushData` (валідний payload, null/undefined, не-об'єкт, відсутні/порожні/невірного типу поля, зайві поля ігноруються); `buildNotificationOptions` (передача даних, стабільний `tag` для дедуплікації); `buildJoinUrl` (точний збіг з форматом invite-посилань F4, URL-encoding спецсимволів); `focusOrOpenClient` (фокус+навігація наявної вкладки, відкриття нової за відсутності, фокус навіть без методу `navigate`, фокус навіть якщо `navigate()` відхилено — exec review iter1 знахідка). 488/488 по проєкту.
- [x] **Impl**: `client/sw.js` (у корені `client/`, НЕ в `client/js/` — критично для scope, exec review iter1 знахідка), `client/index.html` (`navigator.serviceWorker.register("./sw.js")`, беззастережна реєстрація — підписка (Секція PN4) ще не підключена).
- [x] **Exec review**: iter1 — [reviews/push-notifications-PN3-iter1.md](../reviews/push-notifications-PN3-iter1.md). 2 знахідки (Service Worker мав хибний scope через шлях `js/sw.js`, через що `client.navigate()` завжди відхилявся б у реальному браузері; незахищений `await client.navigate()` міг зробити клік по сповіщенню тихим no-op) — обидві виправлено. iter2 — [reviews/push-notifications-PN3-iter2.md](../reviews/push-notifications-PN3-iter2.md), збіжність, нуль нових знахідок.

**Пост-деплой баг (не виявлений тестами/review, знайдений живою перевіркою)**: `client/sw.js` містить top-level `export` (потрібно для `sw.test.js`), а `navigator.serviceWorker.register("./sw.js")` без `{ type: "module" }` реєструє скрипт як classic — `export` там є syntax error → `ServiceWorker script evaluation failed` у реальному браузері (jsdom цього не ловить, бо не виконує файл як SW). Виправлено: `register("./sw.js", { type: "module" })`. Живо підтверджено на `spirit.kolo.media` (`register()` → `{active:true, scope:"https://spirit.kolo.media/"}`) ПІСЛЯ фіксу; до фіксу — `TypeError: ServiceWorker script evaluation failed`. Це саме та причина, чому проєктна дисципліна вимагає живої перевірки, а не лише unit-тестів/review для Service Worker коду.

## Секція PN4: UI — увімкнення сповіщень, обмін підпискою через P2P

- [ ] **Tests**: `client/tests/app.test.js` (доповнення) — новий перемикач "Сповіщення" на екрані «Профіль» (лише для постійного профілю, прихований в ефемерному режимі); увімкнення викликає `Notification.requestPermission()` → `serviceWorker.register()` → `pushManager.subscribe({applicationServerKey})`; підписка додається до власного announce (новий control-тип `push-subscription-announce`, той самий патерн дротування, що й `device-list-announce`); отримання від верифікованого контакту зберігає `contact.pushSubscription`.
- [ ] **Impl**: `client/index.html`, `client/js/app.js` (`CONTROL_MESSAGE_TYPES` += `push-subscription-announce`), `client/js/contacts.js` (поле `pushSubscription: null` у записі контакту).
- [ ] **Exec review**: —

## Секція PN5: Надсилання push при спробі писати офлайн-контакту

- [ ] **Tests**: TBD — потребує мокати `fetch` до push-ендпоінту з `mode:"no-cors"` (CORS-безпечний прямий POST з клієнта в push-сервіс, без участі сервера Spirit).
- [ ] **Impl**: TBD — логіка виявлення "цей контакт не онлайн" (немає активного P2P) + виклик `encryptWebPushPayload`/`signVapidJwt`/`fetch(subscription.endpoint, {mode:"no-cors", ...})` з payload = `{room, token}` щойно створеного invite.
- [ ] **Exec review**: —

## Верифікація

Кожна секція — окремий spec-first/test-first цикл. PN1-PN2 (чисте крипто-ядро) — безпечно почати без додаткових питань. PN3+ (Service Worker, UI, фактичне надсилання) вимагають живої перевірки в РЕАЛЬНОМУ браузері (не jsdom) — push notifications і Service Worker недоступні в тестовому Browser pane sandbox (аналогічно camera/mic), тож фінальна перевірка PN3-PN5 потребує ручного підтвердження користувачем на реальному пристрої/браузері з двома різними профілями/акаунтами Chrome чи Firefox.
