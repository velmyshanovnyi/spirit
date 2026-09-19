# Уніфікація рендера систем налаштувань (backlog D5)

## Контекст

Чотири реєстри (settingsRegistry / designSettingsRegistry / footerRegistry /
advancedMode-флаги) лишаються ЯК Є — сховища не чіпаємо (пряма вимога
беклогу «не переписувати все»). Біль двоякий: (а) чотири майже паралельні
render-функції дублюють один row-скелет (label+span → контрол → hint-text →
reset-кнопка) ~6 разів; (б) кожну нову панель треба НЕ ЗАБУТИ додати в
обробник зміни мови — двічі ловилось як окремий баг.

## Секція U1: спільний row-скелет + єдина точка ре-рендера

1. **Скелет**: приватні хелпери в settingsPanelUI.js —
   `appendCategoryHeading(list, labelText)` і
   `appendSettingRow(list, { labelText, control, descriptionText, resetAttr, resetKey })`
   (control — готовий елемент; description/reset опційні, бо feature-flags
   їх не мають; порядок span↔control конфігурується — feature-flags ставить
   чекбокс перед текстом). Скелет застосовується до ТРЬОХ рендерерів, де
   патерн реально повторюється (settings / design у всіх гілках /
   feature-flags); footer лишається рукописним — його рядки (динамічний
   order-list з textarea й add/remove) інакшого класу, що вже задокументовано
   в самому файлі (FC3). Поведінка й DOM-структура (класи, data-атрибути,
   порядок вузлів) — байт-у-байт ідентичні, наявні panel-тести app.test.js
   це пінять.
2. **Єдина точка**: `initSettingsPanelUI` додатково повертає
   `renderAllSettingsPanels()` — викликає всі чотири. `app.js`-ів
   `refreshAfterLocaleChange` замість перерахування чотирьох функцій кличе
   одну — п'ята майбутня панель, додана всередині settingsPanelUI,
   автоматично потрапляє в мовний ре-рендер. Індивідуальні функції
   лишаються в return для точкових викликів.

- [x] **Tests**: RED — `initSettingsPanelUI(...)` повертає `renderAllSettingsPanels`; наявні мовно-перемикальні тести всіх чотирьох панелей (C6/FC3/GE3) і panel-тести — без змін і зелені (harness еквівалентності DOM).
- [x] **Impl**: settingsPanelUI.js — хелпери + рефакторинг чотирьох рендерерів + renderAllSettingsPanels; app.js — refreshAfterLocaleChange через єдину точку.
- [x] **Exec review**: iter1 — [reviews/settings-render-unification-U1-iter1.md](../reviews/settings-render-unification-U1-iter1.md). PASS_WITH_NOTES, 2 нотатки виправлено; DOM-еквівалентність підтверджена по всіх 6 місцях.
