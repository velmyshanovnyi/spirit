# Розділення екрана «Сервер» (backlog D2)

## Проблема

`data-screen="server"` — смітник із 6 непов'язаних карток: конфіг сигналінгу,
адмінка вузла, реєстр параметрів, дизайн, підвал, feature-флаги. Назва не
відповідає вмісту; симптомом уже став ярлик «Дизайн».

## Рішення (Секція V1)

Два маршрути замість одного:
- **`#/node`** («Вузол») — інфраструктура (server-url/STUN/TURN/signaling-вузли)
  + адмін-панель вузла;
- **`#/settings`** («Налаштування») — реєстр параметрів + дизайн + підвал +
  feature-флаги.

Механіка:
1. `index.html`: секцію розрізано на дві `data-screen` (router.js відкриває
   екрани автодискавері — без змін роутера); nav-item «Сервер» → два
   (`nav.settings` ⚙ / `nav.node` ☁).
2. Ярлик «Дизайн» **ЛИШАЄТЬСЯ** (свідоме відхилення від прогнозу беклогу
   «природно прибирає»): це прямий юзер-реквест 2026-08-08, і картка дизайну
   й далі ділить екран із 3 іншими — ярлик досі економить крок. Ретаргет
   href на `#/settings`; generic data-scroll-target-механіка в app.js
   незмінна.
3. `app.js`: у `ROUTES`/`ADVANCED_ROUTES` "server" → "settings","node".
4. `advancedMode.js` (GE1-флаги керуються ключами advanced-маршрутів):
   "server" (hard-enabled дім панелі флагів) → "settings"; "node" — новий
   toggleable ключ (`featureFlags.feature.node`). Збережені localStorage-флаги
   інших ключів не зачеплені; старий ключ "server" у сховищі ігнорується.
5. i18n ×11 локалей: + `nav.settings`, `nav.node`, `featureFlags.feature.node`;
   − `nav.server` (тест паритету ключів форсує консистентність).
6. Легасі-закладка `#/hash=server`: невідомий маршрут → штатний
   defaultRoute-редірект роутера. Прийнято без alias-а (сесії ефемерні,
   закладки на адмін-підекран малоймовірні; задокументовано тут).

- [x] **Tests**: RED — обидві нові секції існують у реальній розмітці (фікстура A7), стара `data-screen="server"` відсутня; nav має обидва item-и; оновлені наявні server-тести app.test.js (адмінка/вузли/STUN → `node`; панелі налаштувань → `settings`) і advancedMode-тести ("server"→"settings") — зелені; drift-guard/i18n-паритет — зелені.
- [x] **Impl**: index.html, app.js (ROUTES/ADVANCED_ROUTES), advancedMode.js, i18n.js + 9 locale-файлів.
- [x] **Exec review**: iter1 — [reviews/server-screen-split-V1-iter1.md](../reviews/server-screen-split-V1-iter1.md). PASS_WITH_NOTES, 1 знахідка (вакуумний guard-тест) виправлена; жива перевірка — в артефакті.
