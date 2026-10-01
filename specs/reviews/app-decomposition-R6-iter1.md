---
spec: specs/phase5/app-decomposition.md
section: R6 — верифікація ідентичності (власні proof-и + Google) → client/js/identityVerificationUI.js
iter: 1
agent: Opus subagent (чистий контекст; git diff + нові файли; запускав identityVerificationUI/app тести) + добір автора по пунктах, які рев'юер явно позначив як не перевірені
files-reviewed:
  - client/js/identityVerificationUI.js
  - client/js/app.js
  - client/tests/identityVerificationUI.test.js
  - specs/phase5/app-decomposition.md
decision: PASS → 0 знахідок; 1 нотатка (лічильник колсайтів у спеці) виправлена
---

# Знахідки

Жодної.

# Що рев'юер підтвердив як коректне

1. **Verbatim**: три видалені блоки збігаються рядок-у-рядок; дельта — лише
   шапка, 7 імпортів, перенесений `export const ownProofSetKey`, обгортка,
   return, дужка.
2. **Вільні змінні**: усе резолвиться в 7 імпортів тих самих джерел або 6
   ін'єктованих параметрів; `el("server-url")`, `doc.defaultView.google`,
   `doc.head`, dedupe-ключ інтервалу — через ін'єктовані doc/el; жодного
   витоку router/postIdentityRoute/setStatus/render* (єдиний «router» — у коментарі).
3. **TDZ/порядок**: `withBusyButton` hoisted; doc/el/t/state визначені раніше;
   `checkContactProofs` (const із initContactsUI, пізніше) викликається в
   модулі лише з обробника кліку та колбеку інтервалу — thunk безпечний;
   усі колсайти resetOwnProofsState/renderOwnProofsList — в обробниках
   після синхронного initApp; dedupe інтервалу незмінний.
4. **Pruning**: 8 символів + setGoogleStatus — 0 вживань в app.js;
   `ownProofSetKey` резолвиться через новий імпорт на єдиному колсайті;
   acceptNewerProofSet збережений.
5. Прогін рев'юера 404/404 (identityVerificationUI + app).

# Добір автора (пункти, які рев'юер чесно позначив як не перевірені)

- **Глибина покриття app.test.js**: btn-generate-proof (6 згадок), btn-add-proof (5),
  revoke (5), btn-check-proofs-now (3), періодичний таймер (тест 8287 — «starts the
  periodic re-check timer once at init, without stacking»), btn-google-verify (5),
  інжекція GSI-скрипта (2), needs-client-id (через regex /Client ID/). Усі перенесені
  флоу асертяться.
- **Спека↔код**: порядок init (987) перед initRecoveryUI (996) — як у спеці; thunk і
  імпорт ownProofSetKey — як у спеці. Нотатка рев'юера про лічильник «9 колсайтів»
  — формулювання уточнено («7 прямих + передача за значенням»).
- Повний прогін: 1056/1056. Residual: один transient-кластер із 4 швидких (2–4мс)
  падінь у deterministicIdentity.test.js (Argon2/hash-wasm) у першому повному прогоні,
  зник на повторі та ізольовано (7/7) — не в зоні диффу; підозра на конкурентний
  перший lazy-import wasm між воркерами (L1), спостерігати.

# Жива перевірка (обидва хости, 2026-10-02)

- Байти локально == HTTP; `identityVerificationUI.js` у графі модулів.
- kolomedi: на #/profile «Створити доказ» генерує proof-блок у `#proof-block-display`
  (перенесений обробник живий); kibr: той самий флоу + консоль чиста.
