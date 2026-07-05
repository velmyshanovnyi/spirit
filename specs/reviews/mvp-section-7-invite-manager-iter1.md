---
spec: phase1/mvp
section: "Секція 7: Сигнальний вузол — invite-токени й контроль доступу"
iter: 1
agent: opus
files-reviewed:
  - server/library/InviteManager.php
  - server/verify/section7_invite_manager.php
  - server/library/Storage.php
---

## Знахідки

1. **TOCTOU check-then-use між `isTokenValid` і `markInviteUsed`** — під конкуренцією два одночасні `submit_answer` можуть обидва пройти валідацію до позначення токена використаним. Це не виправно всередині `InviteManager` (клас — чистий маніпулятор стану без локів); **перенесено до Секції 10**: контролер має обгорнути всю послідовність load→validate→markUsed→save в `LOCK_EX`, і живий verify Секції 10 має включати конкурентний пробник (два паралельні `submit_answer` з одним токеном).
2. **[Minor] Потенційний `TypeError` у `isSenderAllowed`** — `hash_equals($allowedKey, ...)` впав би при нестроковому елементі whitelist (помилка конфігурації оператора). Виправлено: `(string)`-каст.
3. Поширення `RuntimeException` від `Storage::load()` без catch у `createInvite` — підтверджено **коректним** (fail-closed, без втрати даних, відповідає контракту Storage); занотовано для Секції 10 зловити на верхньому рівні й повернути чисту `500`.
4. Колізія `room_id`/`invite_token` (128 біт кожен, `random_bytes(16)`) — коректно проігноровано, астрономічно малоймовірно.
5. Найменування поля `initiator` (внутрішнє) проти `sender_key` (протокол); немає окремого поля для sender_key учасника (лише його ecdh pubkey) — імовірно достатньо, підтвердити в Секції 10.
6. Verify-скрипт: усі 11 перевірок змістовні; той самий concurrency-сліпий кут, що й у знахідці 1, той самий carry-forward.

## Статус

Знахідка 2 виправлена в тому ж коміті. Знахідки 1, 3, 5, 6 перенесені до Секції 10 (записано в `specs/phase1/mvp.md`). Знахідка 4 — не проблема.
