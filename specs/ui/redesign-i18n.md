# Спека: UI-редизайн, теми, локалізація

Сучасний, юзабельний інтерфейс поверх наявної функціональності (Фази 1-2 недоторкані): світла+темна теми, респонсив (телефон/планшет/ПК), 11 локалей (EN, DE, ES, FR, IT, UK, RU, LT, LV, ET, NO).

Незмінні інваріанти: усі `id` елементів зберігаються (контракт app.js + тестів); українські рядки статусів залишаються байт-у-байт (тести їх пінять; UA — базова локаль тестів).

## Секція U1: i18n-ядро та теми

- [x] **Tests**: `client/tests/i18n.test.js` (jsdom, 12 тестів) — `t(key)` за активною локаллю; інтерполяція `{param}`; fallback EN → сам ключ; `setLocale` персистить, відкидає непідтримувану; `detectLocale` — localStorage → navigator.language (`de-DE`→`de`, `nb/nn`→`no`, непідтримувана → `en`); `applyTranslations` — textContent/`data-i18n`, placeholder/`data-i18n-placeholder`, title+aria-label/`data-i18n-title`; структурний тест повноти (11 локалей × повний набір ключів EN); тест-пін точних legacy-рядків UA. `client/tests/theme.test.js` (3 тести) — збережена тема → `data-theme`; без збереженої — `prefers-color-scheme`; toggle перемикає і персистить.
- [x] **Impl**: `client/js/i18n.js` (словники 11 локалей ~65 ключів, `t`, `setLocale`, `detectLocale`, `applyTranslations`), `client/js/theme.js`.
- [x] **Exec review**: разом із U2 (одна злита зміна), 2 ітерації — [iter1](../reviews/ui-redesign-i18n-iter1.md), [iter2](../reviews/ui-redesign-i18n-iter2.md).

## Секція U2: Редизайн розмітки/стилів та дротування

- [x] **Tests**: `client/tests/app.test.js` — усі наявні тести проходять з `locale: "uk"` (статуси через `t()` — ті самі рядки); нові (3): перемикач теми фліпає `data-theme`; перемикач мови (11 опцій) ре-транслює статичні тексти; **перемикання мови НЕ затирає runtime-контент** (fingerprint/статус — RED→GREEN проти реального бага з ревʼю).
- [x] **Impl**: `client/index.html` (хедер з перемикачами, картки, pre-paint theme проти FOUC, усі id збережені), `client/css/style.css` (токени на `[data-theme]`, `[hidden]`-guard проти display-перекриття, mobile-first grid, focus-visible), `client/js/app.js` (усі статуси через `t()`, `setDynamicText` знімає `data-i18n` при першому runtime-записі, ініціалізація locale/theme/перекладів у `initApp` з опцією `{ locale }`).
- [x] **Exec review**: 2 ітерації, конвергенція — [iter1](../reviews/ui-redesign-i18n-iter1.md), [iter2](../reviews/ui-redesign-i18n-iter2.md). Iter1 знайшла реальний баг затирання runtime-контенту перемиканням мови + прогалину фікстури, що його маскувала. Живо перевірено в preview: light/dark, mobile 375px, DE/FR-локалізація, збереження fingerprint при зміні мови.

## Секція U4: Формат відображуваного Spirit ID (префікс spirit0001)

- [x] **Tests**: `client/tests/spiritId.test.js` (3) — `formatSpiritId(fp)` = `spirit0001` + fingerprint; `parseSpiritId` — точний round-trip, `null` для чужого префікса/не-hex/невірної довжини. `client/tests/app.test.js` — 25 оновлених перевірок показу ID (generate/create/unlock/adopt) з префіксом; перевірки внутрішніх значень (сигналінг, deviceList-ключі) лишилися сирими — регресійний захист від витоку формату в протокол.
- [x] **Impl**: `client/js/spiritId.js` (новий — "0001" це версія формату), `client/js/app.js` — лише шар відображення (pub-key-display, peerVerified-статус, label селектора); storage/протокол недоторкані.
- [x] **Exec review**: 1 ітерація, конвергенція без правок — [iter1](../reviews/ui-spiritid-format-iter1.md). Простежено всі використання senderKey — форматована форма не досягає жодного внутрішнього споживача.

## Секція U3: Деплой і жива верифікація

- [x] **Tests**: —(деплой)
- [x] **Impl**: викладено на spirit.kibr.com.ua та spirit.kolo.media (index.html, css/style.css, усі js-модулі включно з новими i18n.js/theme.js).
- [x] **Exec review**: жива перевірка — preview: light/dark, mobile 375px, DE/FR-локалізація, fingerprint виживає зміну мови; HTTPS-контроль обох хостів: css/i18n.js/theme.js — 200, нова розмітка (40 маркерів data-i18n/перемикачів), сигналінг живий (create_invite success).
