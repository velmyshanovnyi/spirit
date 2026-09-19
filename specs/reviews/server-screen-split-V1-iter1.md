---
spec: specs/ui/server-screen-split.md
section: V1 — розділення екрана «Сервер» на #/settings + #/node
iter: 1
agent: Opus subagent (чистий контекст; git diff по 15+ файлах; перевіряв self-lockout-інваріант, legacy-hash-шлях роутера, i18n-паритет; запускав app/advancedMode/i18n/router тести)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/js/advancedMode.js
  - client/js/i18n.js
  - client/js/locales/*.js
  - client/tests/app.test.js
  - client/tests/advancedMode.test.js
  - specs/ui/server-screen-split.md
decision: PASS_WITH_NOTES → 1 знахідка виправлена, застарілі коментарі почищені
---

# Знахідки та рішення

| # | Файл:рядок | Цитата | Суть | Рішення |
|---|---|---|---|---|
| 1 | app.test.js:1821 | `JSON.stringify({ server: false })` | Bulk-rename зробив self-lockout-guard-тест вакуумним: збережений флаг лишився мертвим ключем "server" — видалення hard-enable з advancedMode.js тест би не зловив | **Виправлено** — флаг `{ settings: false }`, заголовок тесту оновлено; guard знову справжній |

Нотатки (застарілі коментарі зі згадкою "server"-маршруту в index.html/app.js/
settingsPanelUI.js/router.js/app.test.js) — **усі почищені**.

# Що рев'юер підтвердив як коректне

1. **Розріз index.html**: server-екран зник; node = інфра+адмін, settings =
   4 картки налаштувань; секції збалансовані; нові nav-item-и в шаблоні
   решти; «Дизайн»-ярлик ретаргетнутий, без data-route (aria-current-інваріант
   цілий, асертиться тестом).
2. **Маршрути**: ROUTES/ADVANCED_ROUTES з settings+node; жодного функціонального
   хардкоду "server" у client/js; legacy `#/server` → router.js:79 (unknown →
   defaultRoute "account") — точно як заявлено в спеці.
3. **Self-lockout-інваріант**: панель флагів (#feature-flags-list) фізично на
   data-screen="settings" — hard-enabled ключ збігається з екраном, де живе
   панель; застарілий збережений `"server": false` інертний (жоден живий
   маршрут його не читає).
4. **i18n**: nav.settings/nav.node/featureFlags.feature.node у всіх 11 локалях,
   nav.server ніде; паритет-тест зелений; спот-чек de/lt/ru — позиція й
   синтаксис коректні.
5. Тести: найризиковіші перейменування перевірені окремо (aria-current,
   ungated-маршрути, lock-on-advanced-screen, GE3-панель, X2 real-trigger) —
   семантика збережена. Прогін рев'юера 456/456; автора — повний 1054/1054
   (після фіксу знахідки).
6. Спека↔код 1:1, включно з задокументованим відхиленням (ярлик «Дизайн»
   лишився).

# Жива перевірка (обидва хости, 2026-09-19)

- `#/settings`: 4 картки налаштувань рендеряться, nav-item активний;
  `#/node`: інфра (server-url/STUN/TURN/вузли) + адмін-форма; «Дизайн»-ярлик
  веде на settings і скролить до картки дизайну; legacy `#/server` редіректить
  на дефолтний маршрут; консоль чиста.
