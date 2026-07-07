---
spec: ui/redesign-i18n
section: "Секції U1+U2: i18n/теми ядро + редизайн і дротування"
iter: 1
agent: opus
files-reviewed:
  - client/js/i18n.js
  - client/js/theme.js
  - client/js/app.js
  - client/index.html
  - client/css/style.css
  - client/tests/i18n.test.js
  - client/tests/theme.test.js
  - client/tests/app.test.js
---

## Знахідки

**F1 (функціональний баг)**: перемикання мови затирало runtime-контент — `applyTranslations` переписує кожен `[data-i18n]`-елемент, а `#pub-key-display` (показаний fingerprint) і `#connection-status` (живий статус) несли `data-i18n` у новій розмітці. Сценарій: створити профіль → змінити мову → fingerprint замінюється на "не згенеровано".

**F2**: тестова фікстура не віддзеркалювала реальну розмітку (без `data-i18n` на цих двох id) — баг був непомітний для тестів (vacuous pinning).

**F3 (minor)**: `data-i18n-title` в index.html ніколи не споживався — tooltip перемикача теми не локалізувався.

Чисте: інтерполяція ($-безпека через replace-callback), fallback-ланцюжок, guards локалі, `data-i18n` ніде на елементах з дочірніми елементами, якість перекладів de/es/fr/it/ru/lt/lv/et/no — без спотворень.

## Виправлення

`setDynamicText` в app.js (перший runtime-запис знімає `data-i18n`); фікстура віддзеркалює index.html + RED→GREEN тест "language switch must NOT clobber runtime content"; `applyTranslations` обробляє `data-i18n-title` (title + aria-label) + тест.

## Статус

Виправлено, ітерація 2 підтверджує.
