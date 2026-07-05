---
spec: phase1/mvp
section: "Секція 3: Signaling client (long-polling обгортка)"
iter: 1
agent: opus
files-reviewed:
  - client/js/signalingClient.js
  - client/tests/signalingClient.test.js
  - docs/signaling-protocol.md
---

## Знахідки

1. **[Medium] Формат тіла помилки (`data.error`) не був зафіксований у протоколі** — код це припускав, але `signaling-protocol.md` не документував JSON-форму помилки. Виправлено: додано явний рядок у секцію "Коди помилок" — `{ "error": "<читабельне повідомлення>" }` для всіх кодів.
2. **[Low] Abort не скасовував активний HTTP-запит** (`signal` не прокидався у `fetch`) — виправлено: `signal` тепер проходить `apiRequest` → `checkAnswer` → `pollForAnswer`.
3. **[Low] Успішні відповіді не перевірялись на `status: "success"`** — виправлено: `apiRequest` кидає помилку, якщо `data.status` присутній і не дорівнює `"success"`, навіть при HTTP 2xx.
4. **[Medium] Тестова прогалина: гонка abort/active-fetch не була покрита** — доданий тест з керованим вручну pending-проміс fetch, abort посеред запиту, пізнє resolve з валідною відповіддю; підтверджено, що abort перемагає (проміс все одно reject).
5. **[Low] Тестова прогалина: timer-leak на reject-шляху** — доданий тест, де другий `checkAnswer` кидає помилку, перевірка одноразового reject і відсутності подальших запитів.
6. **[Low] Тестова прогалина: non-JSON тіло помилки** — доданий тест, де `response.json()` кидає `SyntaxError` на 500-відповіді, перевірка graceful fallback.

## Статус

Усі знахідки адресовані в тому ж коміті. Перехід до ітерації 2.
