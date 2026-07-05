# Спека: Фаза 2d (частина 1) — Google OAuth-верифікація

Реалізація Google-частини [oauth-verification.md](../../docs/oauth-verification.md): чистий клієнтський OIDC-флоу, nonce-прив'язка ID-токена до identity-ключа, локальна перевірка підпису через публічний JWKS Google. Без бекенду Spirit.

Джерело істини: [docs/oauth-verification.md](../../docs/oauth-verification.md), [docs/decisions.md](../../docs/decisions.md) D14.

## Область цієї специфікації

Криптографічне ядро верифікації ID-токена — найновіша, найбезпекочутливіша й повністю тестовна без зовнішніх залежностей частина. **Не входить у цю специфікацію**: побудова/підпис/доставка повного proof-set (це інфраструктура Секції 2c, ще не реалізована в коді — будувати її наполовину заради одного типу доказу було б передчасною абстракцією). Ця специфікація видає верифіковані claims (email, sub) — прив'язка їх до proof-set відбудеться, коли сама proof-set інфраструктура матиме реалізацію.

## Секція 1: Верифікація Google ID-токена (JWT)

- [x] **Tests**: `client/tests/googleOAuth.test.js`, 17 тестів —
  - `decodeJwt(token)` коректно розбирає header/payload/підпис з реального 3-сегментного JWT; кидає помилку на токені з неправильною кількістю сегментів, пошкодженим base64url, не-JSON чи не-об'єктним (масив) сегментом.
  - `verifyGoogleIdToken` на **справді підписаному** тестовому JWT (тест генерує власну RSA-пару, підписує тестовий токен нею) — успішно повертає `{sub, email, emailVerified, issuedAt, expiresAt}` при коректних `nonce`/`aud`/`iss`/`exp`/`iat`/`alg`.
  - Відхиляє: підроблений підпис, підроблений payload з незмінним підписом, відсутній/невірний `nonce` (включно з випадком, коли викликач забув передати `expectedNonce`), відсутній/невірний `aud`, `iss` не Google, протермінований `exp`, `iat` в майбутньому, `alg` не RS256, `kid` якого немає в JWKS.
- [x] **Impl**: `client/js/googleOAuth.js` — `decodeJwt`, `fetchGoogleJwks` (публічний JWKS-ендпоінт Google, CORS-відкритий, без потреби у `fetch_proof`), `verifyGoogleIdToken` (обов'язкові `expectedNonce`/`expectedAudience`, allowlist `alg`, імпорт ключа через `crypto.subtle.importKey("jwk", ...)`, перевірка підпису RS256, `iss`/`aud`/`nonce`/`exp`/`iat` з 60с clock-skew допуском).
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/google-oauth-section-1-jwt-verification-iter1.md), [iter2](../reviews/google-oauth-section-1-jwt-verification-iter2.md). Знайдено й виправлено критичний обхід nonce-прив'язки через `undefined === undefined`.

## Секція 2: UI-дротування (кнопка "Підтвердити через Google")

- [ ] **Tests**: `client/tests/app.test.js` (доповнення, jsdom, моки `googleOAuth.js` та `window.google.accounts.id`) —
  - Клік "Підтвердити через Google" обчислює `nonce = fingerprint(identityKeyPair.publicKey)` і викликає Google Identity Services SDK з цим `nonce` і налаштованим `client_id`.
  - Отриманий credential передається у `verifyGoogleIdToken` з тим самим `nonce`/`aud`; успіх → статус "Підтверджено через Google: email" у DOM.
  - Помилка верифікації (підроблений/протермінований токен) → статус з повідомленням помилки, не кидає необроблений виняток.
- [ ] **Impl**: `client/index.html` (кнопка, поле для `GOOGLE_CLIENT_ID`), `client/js/app.js` (дротування).
- [ ] **Exec review**: —

## Відкрите питання — реальний live-тест

Юніт-тести Секції 1-2 повністю не залежать від зовнішніх сервісів (крафтимо власний підписаний JWT). Але **реальний браузерний тест повного флоу** (натиснути кнопку → відкривається Google popup → користувач логіниться → повертається справжній токен) вимагає:
1. Реального Google OAuth 2.0 Client ID (створюється в Google Cloud Console, з `Authorized JavaScript origins`, що відповідають домену, де запускається клієнт).
2. Ручної взаємодії користувача з Google-логіном (я не можу і не повинен виконувати вхід у чийсь Google-акаунт).

Це з'ясується окремо, коли дійде до цього кроку — не блокує Секцію 1 (крипто-ядро) чи Секцію 2 (юніт-тестоване дротування з моками).
