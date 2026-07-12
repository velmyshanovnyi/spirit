---
spec: ephemeral-spirit-mode
section: G1-G2 (account screen centering + MRU accounts list)
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/css/style.css
  - client/js/session.js
  - client/js/app.js
  - client/tests/session.test.js
  - client/tests/app.test.js
---

## Знахідки та рішення

1. **[Серйозна, ВИПРАВЛЕНО]** Нове CSS-правило `.screen > .card:only-of-type` мало вищу специфічність за `.card-wide` і перекривало його, звужуючи екрани `conversation`/`contacts`/`history` (усі `card-wide`, кожен єдина `<section>` у своєму `.screen`) до `max-width: 520px` замість повної ширини grid. Особливо боляче для `conversation` (відео-плитки, чат-лог удвічі вужчі). Виправлено: додано `:not(.card-wide)` до селектора.

## Прийнято без змін

- `getRecentAccounts()`/`recordRecentAccount()` (session.js) — коректно обробляють дублікати (переміщення на початок), обрізку до 10, пошкоджений JSON, не-масив.
- `refreshProfileSelector()` — Map-based lookup коректний; MRU-ID без відповідного профілю в `listProfiles()` (видалений/відкликаний) коректно відфільтровується через `.filter(Boolean)`, без винятку.
- `:only-of-type` семантика (рахує siblings за тегом, ігноруючи клас) працює коректно з `display:contents` на `.screen` — селектори рахують реальний DOM, не layout-структуру.

## Верифікація

Повний набір зелений після виправлення: 397/397 (`npx vitest run`; CSS не покривається юніт-тестами, верифікується живо).
