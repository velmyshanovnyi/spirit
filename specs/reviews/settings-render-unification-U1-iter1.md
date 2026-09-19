---
spec: specs/ui/settings-render-unification.md
section: U1 — спільний row-скелет + єдина точка ре-рендера
iter: 1
agent: Opus subagent (чистий контекст; git diff; DOM-еквівалентність по всіх 6 місцях проти видалених рядків; запускав app + settingsPanelUnified тести)
files-reviewed:
  - client/js/settingsPanelUI.js
  - client/js/app.js
  - client/tests/settingsPanelUnified.test.js
  - specs/ui/settings-render-unification.md
decision: PASS_WITH_NOTES → 2 нотатки, обидві виправлено
---

# Нотатки та рішення

| # | Місце | Суть | Рішення |
|---|---|---|---|
| 1 | app.js:1585 | Застарілий коментар посилав читача на `renderSettingsRegistry/renderDesignSettings`, яких у scope більше немає | **Виправлено** — коментар вказує на `renderAllSettingsPanels` (C6+U1) |
| 2 | settingsPanelUnified.test.js:26 | Boundary-тест не чистив/не асертив footer-list — видалення `renderFooterSettings()` з renderAll пройшло б повз усю сюїту, що суперечить самій меті секції | **Виправлено** — цикл clear+assert тепер по всіх ЧОТИРЬОХ списках |

# Що рев'юер підтвердив як коректне

1. **DOM-еквівалентність по всіх 6 місцях**: порядок вузлів, класи
   (settings-row/field/hint-text/btn-link/choice-toggle/order-list) і всі
   dataset-атрибути ідентичні видаленому коду; специфіка feature-flags
   (checkbox ПЕРЕД span через controlFirst, data-feature-key на РЯДКУ)
   відтворена; data-design-setting-key присутній у всіх 4 типах scalar-гілки.
2. **Делеговані слухачі**: всі 7 selector-ів мають емітери, жоден не осиротів.
3. app.js: чотири старі імені більше ніде не вживаються; деструктуризація
   лише renderAllSettingsPanels — без битих референсів.
4. Footer-рендерер не зачеплений диффом (лише включений у renderAll).
5. Спека↔код 1:1, включно з задокументованим footer-винятком.
6. Прогін рев'юера 402/402; автора — повний 1053/1053 (після фіксів нотаток).

# Жива перевірка (обидва хости, 2026-09-19)

- Панелі Settings/Design/Footer/Feature-flags рендеряться на екрані «Сервер»
  (рядки з label+control+hint+reset присутні); перемикання мови de↔uk
  ре-рендерить імперативні лейбли всіх панелей через єдину точку.
