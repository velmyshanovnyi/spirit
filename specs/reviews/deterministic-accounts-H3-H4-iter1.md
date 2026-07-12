---
spec: deterministic-accounts
section: H3-H4
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/app.js
  - client/js/profile.js (adoptScalarIdentity — обгортка, ядро вже перевірене раніше)
  - client/index.html
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/app.test.js
  - client/tests/profile.test.js
---

## Знахідки та рішення

1. **[Medium, ВИПРАВЛЕНО]** Крос-серверний вхід (H4) не встановлював `state.nickname` після успішного входу — на відміну від УСІХ інших шляхів встановлення ідентичності (`btn-profile-unlock` викликає `getNickname`, `btn-profile-confirm` бере зі поля вводу). Сценарій: користувач спочатку запускає ефемерний швидкий чат (`state.nickname = "Тихий Привид"`), потім на екрані «Акаунт» логіниться крос-серверно в акаунт Б — `state.nickname` лишався б застарілим, і наступний `identity-announce` розкрив би peer-у чужий (попередньої сесії) нік під ІНШОЮ ідентичністю. Виправлено: додано `state.nickname = await getNickname(state.senderKey)` одразу після встановлення `state.senderKey`.
2. **[Low, ВИПРАВЛЕНО]** H4-вхід не викликав `rememberSession`/`recordRecentAccount`, на відміну від звичайного `btn-profile-unlock` — акаунт зберігався локально (через `adoptScalarIdentity`), але не пропонувався автоматично через 24-год сесійну пам'ять чи MRU-список при наступному відвідуванні. Виправлено: додано обидва виклики, ідентично до `btn-profile-unlock`.

## Прийнято без змін

- **Timing/side-channel**: порівняння `verifierTail !== expectedTail` — суто локальне, атакуючий і так контролює обидва значення (сам вводить логін+пароль); немає серверного секрету, отже немає потреби в constant-time порівнянні.
- **Перезапис локального акаунта**: `adoptIdentity` (викликається через `adoptScalarIdentity`) ключує запис за `profileId = fingerprint(publicKey)`, похідним від РЕКОНСТРУЙОВАНОГО ключа — акаунт А (випадковий ключ) і акаунт Б (Argon2id-похідний) мають різні публічні ключі → різні `profileId` → різні ключі сховища. Крос-серверний вхід в Б не може стерти А.
- **`el("portable-account-checkbox")`**: чекбокс завжди присутній у тій самій розмітці, що й `btn-profile-confirm` (і в тестовій фікстурі, і в реальному `index.html`) — не є живим null-deref шляхом.
- **Reentrancy**: `withBusyButton` гейтує per-кнопку; теоретична гонка між H3-confirm і H4-login (різні кнопки) не має безпекових наслідків (last-write-wins на `state`), і недосяжна нормальним використанням (взаємовиключні create/login режими).
- **`state.senderKey` семантика**: підтверджено ідентичною для обох шляхів — `profileId` завжди `= fingerprint(publicKey)`, і в `createPermanentProfile`, і в `adoptIdentity`.
- Якість тестів — не тавтологічні, не переперемоковані; `profile.test.js` для `adoptScalarIdentity` використовує реальний Web Crypto (sign/verify round-trip).

## Верифікація

Повний набір зелений після виправлень: 414/414 (`npx vitest run`).
