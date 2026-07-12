---
spec: ephemeral-spirit-mode
section: F1-F5
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/app.js
  - client/js/anonymousNickname.js
  - client/index.html
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/app.test.js
  - client/tests/anonymousNickname.test.js
---

## Знахідки та рішення

1. **[Medium, ВИПРАВЛЕНО]** Паралельні WebRTC-сесії: при переході за invite-посиланням F4 auto-join стартує у фоні одразу, але `#btn-quick-chat` лишався увімкненим протягом цього часу. Клік на нього під час auto-join запускав ДРУГУ, конкуруючу initiator-сесію, що затирала спільний `state` (identityKeyPair/senderKey/pc/channel) поверх joiner-сесії, що вже триває. Виправлено: `#btn-quick-chat` дизейблиться на весь час виконання F4 IIFE (`try/finally`). Покрито новим тестом "disables btn-quick-chat while auto-join is in flight".
2. **[Low, ВИПРАВЛЕНО]** F4 IIFE не мала захисту від повторного запуску, якщо ідентичність вже активна (спека explicit вимагала цього). Додано захисний `if (state.senderKey) return;` на початку — сьогодні завжди хибний за архітектурою (кожен `initApp` починає з чистого `state`), але захищає від майбутнього регресу (напр. авто-відновлення сесії при завантаженні).
3. **[Low, ВИПРАВЛЕНО якість тесту]** Тест "hides the banner in permanent-profile mode" не заповнював `#nickname-input`, тому `state.nickname` лишався `undefined` — тест насправді перевіряв гілку "немає ніку", а не заявлену інваріанту "є vaultKey → банер прихований". Виправлено: тест тепер задає нік перед підтвердженням профілю, реально б'ючи по `vaultKey`-гілці `renderEphemeralBanner()`.

## Прийнято без змін

- `postIdentityRoute()`/`GATED_ROUTES` не конфліктують з F4: `state.senderKey` встановлюється синхронно в IIFE до виклику `startJoinerSession`, тож на момент `afterChannelOpen → router.navigate("conversation")` `hasIdentity()` вже `true`.
- `resetOwnProofsState()` викликається в обох нових шляхах (`btn-quick-chat`, F4 IIFE) — витоку стану доказів між профілями немає.
- Рефакторинг `copyInviteLink()`/`initiateChatSession()` з наявних `btn-copy-invite`/`btn-initiate` — байт-в-байт зберігає стару поведінку, жодних тонких регресій.
- `renderEphemeralBanner()` завжди читає актуальний `state.nickname` з трьох місць виклику — desync немає.
- `generateAnonymousNickname`/F1-тести коректні, не тавтологічні.

## Верифікація

Повний набір зелений після виправлень: 389/389 (`npx vitest run`).
