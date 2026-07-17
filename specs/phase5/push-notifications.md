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

- [ ] **Tests**: `client/tests/webPushCrypto.test.js` (новий файл) — `encryptWebPushPayload(subscriptionKeys, plaintext)` (де `subscriptionKeys = {p256dh, auth}`, base64url з `PushSubscription.toJSON().keys`) реалізує `aes128gcm`-схему з RFC 8291 (ECDH з ефемерним ключем відправника + HKDF → CEK/nonce, AES-128-GCM з внутрішнім padding-роздільником) і повертає бінарний payload у форматі, який Push-сервіс і браузерний Service Worker коректно розшифрують (перевірка через round-trip із власною ж `decryptWebPushPayload`, яку теж реалізуємо для тестів — реальний Service Worker використовує браузерний built-in `PushEvent.data`, наш власний decrypt лише для перевірки коректності схеми в тестах); детермінована структура заголовків (`Content-Encoding: aes128gcm`, `crypto-key`/legacy vs new-header формат — обрати новий `aes128gcm`-only формат, без старого `aesgcm`, оскільки всі актуальні браузери його підтримують); порожній plaintext, plaintext на межі одного запису (4096 байт за замовчуванням record size).
- [ ] **Impl**: `client/js/webPushCrypto.js` (новий, чиста крипто-логіка, без залежності від Service Worker API чи мережі).
- [ ] **Exec review**: —

## Секція PN2: VAPID JWT-підпис

- [ ] **Tests**: `client/tests/vapid.test.js` — `signVapidJwt(vapidPrivateKeyJwk, audience, subject)` повертає валідний ES256 JWT (`{typ:"JWT",alg:"ES256"}` header, `{aud, exp, sub}` payload, підпис перевіряється `crypto.subtle.verify` з відповідним публічним ключем); `exp` — не більше 24 год від видачі (обмеження специфікації VAPID).
- [ ] **Impl**: `client/js/vapid.js`, константи вбудованого VAPID keypair (`client/js/vapidKeys.js` — публічний ключ у forматі, придатному для `applicationServerKey` в `pushManager.subscribe()`; приватний ключ для підпису JWT при відправці).
- [ ] **Exec review**: —

## Секція PN3: Service Worker — реєстрація, підписка, показ сповіщення

- [ ] **Tests**: TBD — Service Worker тестується окремо від основного jsdom-сьюту (потрібен інший тестовий環境, наприклад `@vitest-environment` з мок `self`/`ServiceWorkerGlobalScope`, чи мінімальний integration-тест через `client/tests/serviceWorker.test.js` з ручним мокуванням `self.addEventListener`).
- [ ] **Impl**: `client/js/sw.js` (новий Service Worker файл, реєструється з `index.html`), обробник `push`-події (розшифрування вбудованим `PushEvent.data.json()`/`.arrayBuffer()`, показ `self.registration.showNotification` з `data: {room, token}`), обробник `notificationclick` (відкриває/фокусує вкладку з `?room=&token=#/room`).
- [ ] **Exec review**: —

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
