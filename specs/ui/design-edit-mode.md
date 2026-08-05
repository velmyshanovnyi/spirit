# Спека: Режим редагування дизайну — структура блоків (RF17+)

Запит користувача, записаний у бектрозі 2026-07-22 (`docs/roadmap.md`, "Бектрог UI"):
"кожен інтерфейсний блок (сайдбар, тулбар, плаваюче відео, чат) користувач
може рухати/переміщувати/налаштовувати на свій смак. Активований режим →
можна редагувати розташування; вимкнений → відображається з збереженими
користувацькими налаштуваннями. Кнопка 'Скинути до дефолтних значень'
повертає початковий layout."

Старт цієї фічі підтверджено користувачем 2026-07-25 ("починаємо великий
блок, що стосується структури дизайну").

## Архітектурні рішення (узгоджені з користувачем через AskUserQuestion)

1. **Механізм "переміщення" — перестановка місцями всередині наперед
   визначених слотів/списків ("sitting in a grid"), НЕ вільне
   позиціонування** (на відміну від плаваючого відео, RF4, яке вже має
   власний drag+resize і НЕ чіпається цією фічею — воно вже "рухоме").
   Сайдбар і тулбар — частини flex/grid-розкладки сторінки, а не floating
   window; вільне absolute-позиціонування для них означало б інший клас
   складності (adaptive responsive-layout, z-index/накладання) без явної
   користі.
2. **Обсяг Stage 1**: сайдбар + тулбар + шапка сайту (`.app-header`).
   Плаваюче відео і сам чат НЕ входять у Stage 1 (відео вже рухоме з RF4;
   сам конверсаційний контейнер — не окремий "блок", що має сенс
   переставляти).

## Що конкретно означає "переставити" для кожного з трьох блоків

Жоден з цих трьох блоків не має природного "списку однотипних сусідів" у
поточній розмітці (на відміну від, скажімо, карток на дашборді) — тому
"перестановка в сітці" конкретизується як три незалежні, дрібніші
можливості, кожна зі своїм слотом:

1. **Бік сайдбара** (`sidebarSide: "left" | "right"`) — сайдбар
   (`#app-sidebar`) і основний контент (`main.layout`) міняються місцями
   в `.app-body` (flex `order`). Двослотовий swap.
2. **Бік панелі розмови** (`toolbarSide: "left" | "right"`) —
   `.conversation-toolbar-left` (заголовок + "Ви зараз") і
   `.conversation-toolbar-right` (статус з'єднання + інвайт) міняються
   місцями всередині `#conversation-toolbar` (той самий `order`-прийом).
   Двослотовий swap.
3. **Порядок елементів керування в шапці** (`headerControlsOrder`,
   масив ключів) — `#lang-select`, `#theme-toggle`,
   `.settings-wrap` (шестерня налаштувань), `#header-call-controls`
   (дзвінок/камера/мікрофон, коли видимі) усередині `.header-controls`
   можна переставляти відносно одне одного (N-елементний список, не
   просто пара). `#guest-quick-actions` (кнопки "Створити"/"Увійти" для
   гостя) НЕ входить -- умовно видимий елемент з окремою семантикою, не
   частина списку налаштувань.

## Архітектурне рішення: клік-кнопки замість drag-and-drop

**Свідоме спрощення, яке варто підтвердити з користувачем перед кодом**:
для переставлення пропоную кнопки "◀"/"▶" (чи "⇄" для двослотових
swap-ів) біля кожного елемента в режимі редагування, а НЕ HTML5
drag-and-drop. Причини:
- Native `dragstart`/`dragover`/`drop` API не підтримує touch/мобільні
  пристрої без додаткової бібліотеки-поліфілу (a проєкт свідомо без
  bundler і сторонніх npm-залежностей у браузерному коді, окрім
  vendored ESM) -- отже "чесний" HTML5 DnD або зламаний на мобільних,
  або вимагає власної touch-реалізації (суттєво більший обсяг коду й
  ризик багів).
- Кнопки повністю детерміновані, легко тестуються (click-подія, не
  drag-подія, яку jsdom взагалі не емулює реалістично), доступні з
  клавіатури (accessibility) без додаткової роботи.
- Для двослотових swap-ів (сайдбар/тулбар) кнопка "⇄" -- це взагалі
  найпростіший можливий UI, drag тут надлишковий.

Якщо користувач наполягає на "перетягуванні" буквально -- це окрема,
більша дискусія (потрібен touch-сумісний DnD-шар), відкладається до
явного запиту.

## Персистентність

`localStorage`, той самий пристрій-рівень прецедент, що й
`spirit.theme`/`spirit.folders`/`spirit.floatingVideoRect`/
`spirit.designSettings.*`/`spirit.uiVisibility.*` (за аналогією з
RF14-16) -- НЕ прив'язано до акаунта:
- `spirit.layout.sidebarSide` -- `"left"` (default) | `"right"`.
- `spirit.layout.toolbarSide` -- `"left"` (default) | `"right"`.
- `spirit.layout.headerControlsOrder` -- JSON-масив ключів, default
  `["langSelect","themeToggle","settingsGear","headerCallControls"]`.

## UI

- Новий перемикач "Режим редагування макета" -- кнопка в розділі
  "Дизайн" на екрані «Сервер» (поруч із "Скинути весь дизайн до
  типового"), НЕ окрема іконка в шапці (шапка сама є об'єктом
  редагування -- дивно ховати керування в елементі, який редагується).
  Активний режим додає `body.layout-edit-mode` -- CSS показує
  пунктирні рамки й кнопки-стрілки на трьох зареєстрованих блоках,
  незалежно від того, на якому екрані користувач зараз є (сайдбар і
  шапка видимі майже завжди; тулбар -- лише на екрані розмови).
- Кожен слот -- свій ряд у розділі "Дизайн" (нова категорія "layoutEdit"
  / "Розташування блоків"), з описом і кнопкою "⇄"/"◀▶" ПРЯМО В
  ПАНЕЛІ НАЛАШТУВАНЬ (не тільки inline на самій сторінці) -- узгоджено
  з наявним патерном RF14-16, де всі налаштування зібрані в одному
  розділі, а не розкидані по сторінці. Inline-кнопки на самих блоках
  (при активному режимі редагування) -- ДОДАТКОВИЙ, зручніший шлях,
  не єдиний.
- Кнопка "Скинути макет до типового" (окремо від "Скинути весь дизайн"
  RF14-16, чи як розширення тієї самої кнопки -- рішення на етапі
  імплементації).

## Уточнення обсягу під час імплементації RF17 (спрощення)

Реалізовано БЕЗ окремого "режиму редагування макета" з inline-кнопками
прямо на сторінці -- замість цього новий тип налаштування `"choice"`
доданий у ТОЙ САМИЙ `designSettingsRegistry.js`/розділ "Дизайн" на
екрані «Сервер», де вже живуть RF14-16 (кольори/форма/типографіка/
ширина/видимість). Пара кнопок "Зліва"/"Справа" рендериться прямо в
рядку налаштування (той самий `.settings-row`, що й для кольору/числа),
а не як окремий toggle-режим з рамками навколо блоків на сторінці.
Причина: ОДИН уніфікований розділ налаштувань, куди користувач уже
звик заглядати для всього дизайну (той самий принцип, що вже двічі
підтверджений у RF14-16), простіше й дешевше в підтримці, ніж друга
паралельна UI-парадигма ("режим редагування" з інлайн-стрілками). Якщо
згодом виявиться недостатньо зручним -- inline-кнопки можна додати
пізніше, не змінюючи саму persistence-модель.

## Стадії

- [x] **Stage RF17 -- бік бічної панелі (сайдбар зліва/справа)**
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js`, новий
        `describe("Section RF17: layout edit mode -- sidebar side swap")`
        (3 тести: default = `null`/зліва; валідний/невалідний choice
        через `setDesignSetting`; `applyDesignSettings` виставляє/знімає
        `data-sidebar-side` на `:root`). Registry-shape тест розширено
        під `type: "choice"` (`options`-масив ≥2, `rootAttribute`).
        `client/tests/app.test.js`, новий тест: клік по кнопці "Справа"
        виставляє `data-sidebar-side="right"` і підсвічує активну
        кнопку; клік "Зліва" повертає назад. Існуючий тест "renders one
        input per registered design setting" (RF14) скоригований під
        нову форму рендеру (choice-тип рахується як ОДНА група кнопок,
        не окремий `[data-design-setting-key]` input). Разом: 331/331
        (307 у `app.test.js` + 23 у `designSettingsRegistry.test.js`
        + 1 новий у кожному).
  - [x] **Impl**: `client/js/designSettingsRegistry.js` -- новий
        `type: "choice"` (`options: string[]`, `optionLabels`,
        `rootAttribute`), `getDesignSetting`/`setDesignSetting`
        валідують проти `options`, `applyDesignSettings` виставляє/знімає
        `root.dataset[rootAttribute]`; новий запис `sidebarSide`
        (`"left"`/`"right"`, default `"left"`) у категорії `layout` (не
        нова категорія -- логічно те саме, що ширина сайдбара). `client/js/app.js`
        -- `renderDesignSettings` розширено гілкою для `type==="choice"`
        (пара `<button class="chip">`, підсвітка активної через
        `chip-active`, замість `<input>`), новий делегований click-обробник
        `[data-design-choice-key]` у тому самому `#design-settings-list`.
        `client/css/style.css` -- `:root[data-sidebar-side="right"]`
        перемикає `order`/бордер на `#app-sidebar`/`.app-body > .layout`
        (flex `order`, DOM-порядок не чіпається); `.choice-toggle`/
        `.chip`/`.chip-active` (той самий вигляд, що й `.sidebar-filters
        .chip`, але той клас скопований лише туди -- переозначено тут
        глобально для перевикористання).
  - [x] **Exec review**: самоперевірка -- (а) на mobile-брейкпоінті
        (`@media max-width: 768px`) `.app-body` стає `display:block`,
        де `order` не має ефекту (властивість лише для flex/grid-дітей)
        -- перевірено читанням CSS, конфлікту з мобільним stacking немає;
        (б) `sidebarSide` default (`null` -- немає запису) рендериться
        як `"left"` активна кнопка (перший елемент `options`), узгоджено
        з тим, що стилі за замовчуванням і так дають сайдбар зліва;
        (в) 331/331, без регресій у наявних RF14-16 тестах.
- [x] **Stage RF18 -- бік панелі розмови**
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js`, новий
        `describe("Section RF18: layout edit mode -- conversation toolbar
        side swap")` (3 тести, той самий шаблон, що й RF17: default
        `null`/зліва; валідний/невалідний `setDesignSetting`;
        `applyDesignSettings` виставляє/знімає `data-toolbar-side`).
        `client/tests/app.test.js`, новий UI-тест: клік "Справа"/"Зліва"
        перемикає атрибут і підсвітку активної кнопки. Жодних змін у
        існуючих тестах не знадобилось -- RF17's generic choice-рендер і
        "renders one input..." лічильник уже узагальнені на будь-яку
        кількість `choice`-записів. Разом: 335/335 (309 у `app.test.js`
        + 26 у `designSettingsRegistry.test.js`).
  - [x] **Impl**: `client/js/designSettingsRegistry.js` -- новий запис
        `toolbarSide` (той самий `type: "choice"`, `options`, категорія
        `layout`) -- ЖОДНИХ змін у `app.js`'s рендер/обробниках не
        знадобилось (RF17 вже зробила `type==="choice"` повністю
        generic-ним, підтверджено відсутністю рядка `"sidebarSide"` у
        `app.js`). `client/css/style.css` --
        `:root[data-toolbar-side="right"]` перемикає `order` на
        `.conversation-toolbar-left`/`.conversation-toolbar-right` (той
        самий `order`-прийом, DOM-порядок не чіпається).
  - [x] **Exec review**: самоперевірка -- (а) `.conversation-toolbar` --
        звичайний flex-рядок (`justify-content: space-between`), `order`
        працює без побічних ефектів; (б) generic-рендер з RF17
        підтвердив свою цінність буквально без жодної зміни в `app.js`
        для цієї стадії -- сама архітектурна ставка (реюзабельний
        `"choice"`-тип) себе виправдала; (в) 335/335, живо перевірено на
        `spirit.kibr.com.ua` (клік/CSS/getBoundingClientRect
        підтверджують реальне переміщення) -- `spirit.kolo.media` у
        поточній браузерній сесії застряг на артефакті кешу ES-модулів
        інструмента (не пов'язано з кодом, задокументовано в RF17,
        актуально й тут), деплой на обидва хости ідентичний і
        підтверджений прямим `fetch`.
- [x] **Stage RF19 -- порядок елементів шапки**
  - [x] **Tests**: `client/tests/designSettingsRegistry.test.js`, новий
        `describe("Section RF19: layout edit mode -- header controls
        order")` (3 тести: default `null`/DOM-порядок; валідна/невалідна
        перестановка через `setDesignSetting` -- неправильна довжина й
        невідомий ключ обидва відхиляються; `applyDesignSettings`
        виставляє/знімає inline `order` на РЕАЛЬНИХ DOM-елементах для
        всіх 4 записів). Registry-shape тест розширено під
        `type: "order"` (`items`-масив ≥2 з `key`/`label`/`selector`
        кожен). `client/tests/app.test.js`, новий тест: клік "▲" міняє
        `themeToggle` з `langSelect` місцями, перевірено inline `order`
        на всіх 4 реальних елементах. Виправлено HTML-фікстуру тестів
        (`.settings-wrap` обгортка навколо `#btn-settings-toggle` була
        відсутня -- необхідна, бо `order` впливає лише на ПРЯМИХ
        flex-дітей). "renders one input..." (RF14) лічильник розширено
        під `order`-групи. Разом: 339/339 (310 у `app.test.js` + 29 у
        `designSettingsRegistry.test.js`).
  - [x] **Impl**: `client/js/designSettingsRegistry.js` -- новий
        `type: "order"` (`items: [{key,label,selector}]`, зберігається
        як JSON-масив-перестановка, а не один рядок/число як в інших
        типів); `getDesignSetting` валідує, що збережений масив -- це
        ТОЧНО та сама множина ключів, що й `items` (довжина + повне
        покриття, без урахування порядку самого масиву); `applyDesignSettings`
        виставляє `node.style.order` за індексом у збереженому масиві,
        знімає (`removeProperty`) при відсутності перевизначення.
        Новий запис `headerControlsOrder` (4 елементи: дзвінок/камера/
        мікрофон, мова, тема, шестерня) -- порядок масиву `items`
        збігається з реальним DOM-порядком у `client/index.html` (той
        самий "default = стилі й так це роблять" принцип, що й в інших
        RF14-19 записів). `client/js/app.js` -- `renderDesignSettings`
        розширено гілкою для `type==="order"` (вертикальний список,
        кожен рядок -- лейбл + кнопки "▲"/"▼", перша/остання
        задизейблені); новий click-обробник `[data-order-setting-key]`
        обчислює новий масив через swap двох сусідніх елементів і
        викликає `setDesignSetting`+`applyDesignSettings`+ре-рендер.
        `client/css/style.css` -- `.order-list`/`.order-list-item`
        (простий вертикальний список рядків).
  - [x] **Exec review**: самоперевірка -- (а) `order` -- CSS-властивість,
        що впливає ЛИШЕ на прямих flex/grid-дітей; `.settings-wrap`
        (не внутрішня кнопка) -- справжній прямий дочірній елемент
        `.header-controls` у реальній розмітці, підтверджено читанням
        `client/index.html`; (б) default (немає запису) застосовується
        як `removeProperty("order")` для ВСІХ items одночасно (не
        "виставити 0,1,2,3 явно") -- узгоджено з тим, що стилі й так
        дають DOM-порядок за замовчуванням, підтверджено живою
        перевіркою (нижче); (в) 339/339; живо перевірено на
        `spirit.kibr.com.ua`: список із 4 підписаних рядків рендериться
        коректно, клік "▲" на "Перемикач теми" реально міняє фізичні
        координати (`getBoundingClientRect`) теми й мови в шапці
        (theme.x 1163→1086, lang.x 1086→1130), скидання повертає
        `order` до `"0"` для всіх. Цим завершується весь Stage 1 фічі
        "режим редагування дизайну" (сайдбар/тулбар/шапка, RF17-19).

## Stage 2 (2026-08-05, за прямим запитом користувача) -- плаваюче відео + структура чату

Бектрог (`docs/roadmap.md`, "Бектрог UI") досі позначав "плаваюче відео і
структуру самого чату" як "не почато" -- але Stage 1's власне архітектурне
рішення (пункт 1 вище) вже сказало, що плаваюче відео НЕ входить у цю
фічу (воно вже рухоме, RF4), а сам чат-контейнер "не блок, що має сенс
переставляти". Перш ніж кодити, уточнено з користувачем (AskUserQuestion,
2026-08-05), що саме малось на увазі під цими двома пунктами тепер, коли
Stage 1 уже готовий:

- **Плаваюче відео**: (а) кнопка "Скинути позицію" -- повертає
  `spirit.floatingVideoRect` до дефолтної позиції/розміру, той самий
  патерн, що й "Скинути весь дизайн"; (б) перемикач float/docked --
  можливість закріпити відео як звичайний блок у розмітці чату замість
  плаваючої overlay-панелі.
- **Структура чату**: ширина/розташування самого чат-контейнера.

### Дослідження поточного коду (перед дизайном секцій)

- `spirit.floatingVideoRect` (`client/js/app.js:1765`) -- `{left, top,
  width, height}` у пікселях, читається/пишеться через
  `loadFloatingVideoRect()`/`saveFloatingVideoRect()`
  (`app.js:1766-1781`). Дефолт обчислюється (не зберігається як окремий
  запис) у `app.js:1807-1814` -- правий нижній кут вікна,
  ширина/висота з `settingsRegistry.js`'s `floatingVideoDefaultWidth`/
  `floatingVideoDefaultHeight`. Уся apply/drag/resize-логіка -- IIFE
  всередині `initApp()` (`app.js:1782-1884`), НЕ окрема експортована
  функція -- немає наявної точки входу "скинути" ззовні цього блоку.
  `#floating-video` (`client/index.html:713-717`) -- `position: fixed`
  (`client/css/style.css:1001-1049`), позиція/розмір виставляються
  ЛИШЕ inline JS-стилями (CSS не тримає жодної координати).
- `.layout` (`client/css/style.css:286-293`) -- CSS grid, **захардкожений**
  `max-width: 1100px`, немає власного CSS var. `.card-wide`
  (`style.css:302-304`, використовується конверсаційним екраном) --
  `grid-column: 1 / -1`, займає всю ширину `.layout`. Наявні
  design-setting-CSS-var (`--content-max-width`, `--sidebar-width`)
  контролюють ЗАГАЛЬНУ ширину застосунку й сайдбар, а не саму
  чат-колонку.
- `designSettingsRegistry.js` не має жодного "action"-типу (кнопка без
  збереженого значення) -- лише `color|length|text|choice|order|boolean`.
  Найближчий наявний "reset"-прецедент -- `btn-reset-all-design-settings`
  (звичайна кнопка ПОЗА реєстром, у `index.html`+`app.js` напряму), не
  через сам реєстр.

### Секція RF20 -- кнопка "Скинути позицію відео"

Свідомо ПОЗА `designSettingsRegistry.js` (як і `btn-reset-all-design-settings`
сам собою) -- `spirit.floatingVideoRect` НЕ є записом цього реєстру
(немає "дефолтного" значення для порівняння, дефолт обчислюється
динамічно від розміру вікна), тож не має сенсу вводити новий
"action"-тип лише заради одного нетипового випадку.

- [x] **Tests**: `client/tests/app.test.js` -- новий тест: після
      drag/resize (симуляція pointerdown/move/up, за наявним патерном
      RF4-тестів для floating video) `spirit.floatingVideoRect` містить
      нестандартні координати; клік по `#btn-reset-floating-video`
      видаляє запис і негайно перераховує/застосовує дефолтний rect (без
      релоаду) -- порівняти координати ДО й ПІСЛЯ через inline style.
      Другий тест: та сама перевірка, коли панель ПРИХОВАНА (реальний
      сценарій -- кнопка на екрані "Сервер", панель видима лише на
      "Розмова") -- виправлено після exec review, першопочатковий варіант
      лише перевіряв "не кидає помилку", що проходив і з баґом.
- [x] **Impl**: `client/index.html` -- нова кнопка
      `#btn-reset-floating-video` в розділі "Дизайн". `client/js/app.js`
      -- floating-video IIFE переприсвоює зовнішню `let resetFloatingVideoRect`
      (видаляє `localStorage` запис, застосовує дефолтний rect
      БЕЗУМОВНО -- не лише коли панель видима, бо в реальному UI вона
      завжди прихована в момент кліку). Новий i18n-ключ
      `design.resetFloatingVideo` для 11 локалей.
- [x] **Exec review**: 1 ітерація, зійшлося, 1 реальна знахідка
      виправлена (guard `!panel.hidden` робив скидання невидимим до
      наступного релоаду -- прибрано). Див.
      `specs/reviews/design-edit-mode-RF20-iter1.md`.

### Секція RF21 -- перемикач float/docked

**Найризикованіша секція**: "docked" означає видимий рендер
`#floating-video` ВСЕРЕДИНІ конверсаційної картки (`.card-wide`), а не
просто зміну `position` на місці -- сам елемент зараз змонтований поза
`.layout` (перевірено читанням `index.html`), тож `position: static` без
переміщення DOM-вузла показав би відео там, де воно фізично лежить у
дереві (не в чаті). Тому "docked" вимагає УМОВНОГО реального
DOM-переміщення (`appendChild`/`insertBefore`) відео-панелі всередину
`.card-wide` (перед `#chat-log`) під час активного дзвінка, і назад до
початкової точки монтування при поверненні в "float"-режим -- НЕ просто
CSS-перемикач, як усі попередні `choice`-записи Stage 1.

- [ ] **Tests**: `client/tests/designSettingsRegistry.test.js` --
      новий `describe("Section RF21: layout edit mode -- video float/docked mode")`
      (тим самим шаблоном, що й RF17/RF18: default `null`/`"float"`;
      валідне/невалідне значення через `setDesignSetting`;
      `applyDesignSettings` виставляє/знімає `data-video-mode`).
      `client/tests/app.test.js` -- новий тест: під час активного
      дзвінка (мокнутий `getUserMedia`/RTCPeerConnection, за наявним
      патерном video-call тестів) перемикання на "docked" переміщує
      `#floating-video` усередину `.card-wide` (перевірити
      `parentElement`/`compareDocumentPosition`), вимикає
      pointerdown/ResizeObserver-логіку (перевірити, що
      `spirit.floatingVideoRect` НЕ змінюється при спробі "перетягнути"
      докований елемент); перемикання назад на "float" повертає вузол
      на початкову позицію (перед `#app-footer`, чи де він фактично
      змонтований у `index.html`) і відновлює drag/resize.
- [ ] **Impl**: `client/js/designSettingsRegistry.js` -- новий запис
      `videoMode` (`type: "choice"`, `options: ["float","docked"]`,
      категорія `layout`, `rootAttribute: "videoMode"`).
      `client/js/app.js` -- floating-video IIFE зберігає посилання на
      оригінальний батьківський вузол/наступного сиблінга при ініціалізації
      (для точного повернення); новий обробник, підписаний і на
      `designSettingsRegistry`'s зміну (той самий `onVisibilityChange`-
      подібний коллбек, що й для advanced mode/footer), і на подію
      "дзвінок почався/закінчився" -- застосовує реальне DOM-переміщення
      ЛИШЕ коли обидві умови істинні (docked-режим AND активний дзвінок);
      у docked-режимі pointerdown/ResizeObserver-слухачі на панелі
      вимкнені (early-return, не видалені -- щоб не плодити повторну
      підписку при поверненні в float). `client/css/style.css` --
      `:root[data-video-mode="docked"] .floating-video` скасовує
      `position:fixed`/`resize`, робить звичайним block-елементом
      (`position: static; width: 100%; height: auto; margin-bottom: var(--gap)`
      чи подібне, узгодити з наявною версткою `.card-wide` під час
      імплементації).
- [ ] **Exec review**: заплановано (ця секція торкається живого
      відеодзвінка -- обов'язкова жива перевірка реального
      pointerdown/pointerup drag-флоу на обох хостах, не лише unit-тести,
      перш ніж вважати завершеною).

### Секція RF22 -- ширина чат-контейнера

Найпростіша й найменш ризикована секція -- той самий `type: "length"`
патерн, що вже тричі підтверджений (`contentMaxWidth`/`sidebarWidth`/
`cornerRadius` та інші RF14-16 записи), лише новий CSS var замість
захардкодженого значення.

- [x] **Tests**: `client/tests/designSettingsRegistry.test.js` --
      новий `describe("Section RF22: layout edit mode -- conversation width")`
      (default `null`/1100; валідне/невалідне (поза `min`/`max`) значення
      через `setDesignSetting`; `applyDesignSettings` виставляє/знімає
      `--conversation-width` на `:root`). Жодних нових тестів у
      `app.test.js` не знадобилось (той самий доказ generic-архітектури,
      що й RF18) -- підтверджено запуском наявних design-тестів.
- [x] **Impl**: `client/js/designSettingsRegistry.js` -- новий запис
      `conversationWidth` (`type: "length"`, `cssVar:
      "--conversation-width"`, категорія `layout`, `min: 600`,
      `max: 1600`). `client/css/style.css` -- `.card-wide`
      перевикористовується екранами `manage`/`history` теж, тому селектор
      скоуплений: `[data-screen="conversation"] .card-wide` (max-width +
      `margin-inline: auto`) ТА `[data-screen="conversation"] .layout`
      (`max-width: max(1100px, var(--conversation-width, 1100px))` --
      виправлено після exec review, без цього `.layout`'s власний
      захардкоджений `max-width:1100px` унеможливлював майже весь
      діапазон вище ~1052px). Нові i18n-ключі
      `designSettings.conversationWidth.label`/`.description` для 11
      локалей.
- [x] **Exec review**: 1 ітерація, зійшлося, 1 реальна знахідка
      виправлена (налаштування могло лише звужувати картку, ніколи
      розширювати -- `.layout`'s власний cap не давав діапазону вище
      1100px жодного ефекту). Див.
      `specs/reviews/design-edit-mode-RF22-iter1.md`.

### Секція RF23 (2026-08-05, за прямим запитом користувача) -- позиція тосту "розділ вимкнено"

Користувач надіслав скріншот тосту `#advanced-mode-notice` (SM3,
"Цей розділ вимкнено.") і попросив можливість налаштувати, ДЕ саме на
екрані він з'являється. Той самий `type: "choice"` патерн, що й
`sidebarSide`/`toolbarSide`/`videoMode` вище -- generic-рендер
(`renderDesignSettings`) уже підтверджено тричі як такий, що не вимагає
змін в `app.js` для нового `choice`-запису.

- [ ] **Tests**: `client/tests/designSettingsRegistry.test.js` --
      новий `describe("Section RF23: layout edit mode -- restricted-route notice position")`
      (тим самим шаблоном: default `null`/`"bottom-center"`;
      валідне/невалідне значення через `setDesignSetting` (6 опцій:
      `top-left`/`top-center`/`top-right`/`bottom-left`/`bottom-center`/
      `bottom-right`); `applyDesignSettings` виставляє/знімає
      `data-notice-position` на `:root`). `client/tests/app.test.js` --
      жодних нових тестів не мало б знадобитись (той самий доказ
      generic-архітектури, що й RF18/RF22) -- підтвердити читанням, чи
      "renders one input..." (RF14) лічильник і так рахує нову
      choice-групу автоматично.
- [ ] **Impl**: `client/js/designSettingsRegistry.js` -- новий запис
      `noticePosition` (`type: "choice"`, `options: ["top-left","top-center","top-right","bottom-left","bottom-center","bottom-right"]`,
      категорія `layout`, `rootAttribute: "noticePosition"`, дефолт
      `"bottom-center"` -- збігається з наявним захардкодженим
      положенням, щоб нічого не зрушилось для тих, хто не чіпав це
      налаштування). `client/css/style.css` -- `.advanced-mode-notice`'s
      наявні `left:50%; bottom:40px; transform:translateX(-50%)`
      переносяться під `:root[data-notice-position="bottom-center"]`
      (чи взагалі лишаються дефолтом БЕЗ атрибута, якщо `rootAttribute`
      не виставляється для дефолтного значення -- узгодити з наявним
      патерном `sidebarSide`, де відсутність запису = перша опція),
      додаються 5 інших варіантів (`top-*`: `top: 40px` замість
      `bottom`; `*-left`/`*-right`: `left: 24px`/`right: 24px` замість
      `left:50%; transform`). `client/js/i18n.js` -- нові ключі
      `design.noticePosition.*` (лейбл/опис) + `designSettings.position.*`
      (6 підписів опцій) для всіх 11 локалей.
- [ ] **Exec review**: заплановано.

(Деталізація Tests/Impl по кожній стадії -- у момент старту роботи над
нею, за тим самим патерном, що й RF14-16.)
