---
spec: specs/phase5/deploy-freshness.md
section: F1 — fetch-обробник примусової ревалідації в sw.js
iter: 1
agent: Opus subagent (чистий контекст; git diff; запускав sw.test.js)
files-reviewed:
  - client/sw.js
  - client/tests/sw.test.js
  - specs/phase5/deploy-freshness.md
decision: PASS_WITH_NOTES → 0 знахідок з доказовим баром, 3 нотатки
---

# Знахідки

Жодної знахідки, що відповідає бару доказовості (file:line + цитата + сценарій збою).

# Нотатки та рішення

| # | Місце | Суть | Рішення |
|---|---|---|---|
| 1 | sw.js (fetch handler) | `no-cache` обходить і memory cache → кожен субресурс коштує умовний round-trip; на повільній (але живій) мережі фолбека немає | **Прийнято** — це і є задекларований у спеці трейдофф (304 дешеві, свіжість важливіша); спостерігати на мобільному |
| 2 | sw.js (`c8 ignore` коментар) | Рація ignore-блоку згадувала лише Push/Notification/Clients, а тепер покриває й F1-глю | **Виправлено** — коментар доповнено (FetchEvent недоступний у jsdom; глю покривається живою перевіркою) |
| 3 | спека F1 | Залишкове зобов'язання — жива перевірка на обох хостах перед тіком Exec review | **Виконується** — див. нижче в артефакті після перевірки |

# Що рев'юер підтвердив як коректне

`shouldForceRevalidate` тотальна (URL у FetchEvent завжди абсолютний, `new URL` не кидає);
POST до `/spirit/*` і cross-origin (accounts.google.com) не перехоплюються взагалі;
navigate-запити: init скидає mode у "same-origin" за специфікацією, credentials/headers/Range
успадковуються; фолбек безпечний (GET без тіла — повторний fetch можливий);
skipWaiting/claim не ламають відкриті сторінки (SW без кешу і стану);
push-обробники не зачеплені; тести ↔ спека 1:1, non-vacuous. sw.test.js 17/17, повний прогін 1032/1032.

# Жива перевірка (обидва хости, після деплою)

- kolomedi і kibr: `navigator.serviceWorker.controller` активний (SW контролює сторінку);
  `fetch('/js/app.js')` (cached) == `fetch(..., {cache:'no-store'})` (fresh) — байт-у-байт.
- Деплой зміненого файлу → один reload → сторінка виконує нову версію (перехідний
  перший reload після встановлення самого F1 — очікувано за спекою).
