---
spec: specs/phase5/test-stability.md
section: T1+T2+T3 — staleness-guard armIceTimeout, глобальний testTimeout, таймер-ріпер harness
iter: 1
agent: Opus subagent (чистий контекст; git diff; перевіряв non-vacuity видаленням guard-рядка; запускав app/profile/deterministicIdentity тести)
files-reviewed:
  - client/js/app.js
  - vitest.config.js
  - client/tests/app.test.js
  - client/tests/profile.test.js
  - client/tests/deterministicIdentity.test.js
  - specs/phase5/test-stability.md
decision: PASS_WITH_NOTES → 1 знахідка виправлена, 2 нотатки задокументовані в спеці
---

# Знахідки та рішення

| # | Файл:рядок | Цитата | Суть | Рішення |
|---|---|---|---|---|
| 1 | test-stability.md:38,44 | `testTimeout/hookTimeout 30000` | Спека казала 30000, код — 60000 (стелю підняли після написання спеки: під повним насиченням ядер 30с лишало 10 падінь) | **Виправлено** — спека оновлена: 60с + пояснення, чому 30с не вистачило, і що adversarial-насичення поза скоупом |

# Нотатки (прийнято, задокументовано в спеці без змін коду)

2. app.js:3197 — тимчасова підміна `activeConnectionId` під час mesh-диспетчингу
   вхідного повідомлення: справжній ICE-timeout у цьому суб-мс вікні при ≥2 пірах
   буде проковтнутий guard-ом.
3. app.js:3702 — єдиний `setInterval` у client/js (proof-recheck) не трекається
   T3-ріпером, але самодедуплікується через window-ключ — не клас витоку.

# Що рев'юер підтвердив як коректне

- **Non-vacuity нового тесту**: видалення guard-рядка → тест падає; повернення → зелений.
- **T1**: усі колсайти `armIceTimeout` перевірено — `activeConnectionId` на момент
  зведення завжди non-null (proxy-setter `ensureActivePeer()` спрацьовує навіть на
  null-запис); id — random, старий запис видаляється → «змінився і повернувся» неможливо;
  guard не глушить справжні таймаути в 1:1 флоу.
- **T3**: `vi.clearAllMocks()` після установки шпигуна чистить лише історію викликів,
  не mockImplementation (mockReset/restoreMocks у конфігу не ввімкнені) — підтверджено
  емпірично (vi.waitFor працює в усіх 396 тестах); порядок hooks (root-before → suite
  fake timers → suite useRealTimers → root mockRestore) коректний.
- **T2**: єдиний wall-clock регрес-асершн (pow.test.js:127) — in-test, стеля ранера
  не впливає; залишковий sub-60s `waitFor {timeout:2000}` (app.test.js:6419) — poll-bound,
  поза скоупом T2.
- Прогони: 434/434 (3 файли в рев'ю); у автора: повний прогін 1038/1038 двічі чисто
  і 1038/1038 під помірним стресом (N/2 ядер busy-loop) — проти 72 падінь до фіксу.

# Залишкова невизначеність

- Один неідентифікований transient-фейл у проміжному чистому прогоні (деталі
  втрачено), не відтворений у 3 наступних повних прогонах — спостерігати.
- Повне насичення всіх ядер (N−1 busy-loop) все ще дає timeout-падіння крипто-тестів —
  прийнято як out-of-scope (нереалістичний для CI-ранера режим).
