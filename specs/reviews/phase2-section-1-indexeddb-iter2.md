---
spec: phase2/profiles
section: "Секція 1: IndexedDB-обгортка (загальне зашифроване сховище)"
iter: 2
agent: opus
files-reviewed:
  - client/js/db.js
  - client/tests/db.test.js
  - specs/phase2/profiles.md
---

## Знахідки

**Підтверджено активною, не dismissed**: reviewer не погодився з тезою ітерації 1, що гонку "read succeeds, tx aborts after" неможливо практично відтворити у `fake-indexeddb`. Довів проб-скриптом, що `tx.abort()`, викликаний синхронно всередині `request`-обробника `success`, детерміновано форсує саме цю гонку в `fake-indexeddb@6.2.5` — і що фікс ітерації 1 (`tx.oncomplete`) справді коректно відхиляє в цьому сценарії, тоді як стара реалізація (`resolve(request.result)` напряму в `onsuccess`) мовчки повернула б застаріле значення.

## Статус

Додано тест через monkey-patch `IDBTransaction.prototype.objectStore` (з `try/finally` відновленням), що форсує реальну гонку на продакшн-функції `get()`. Test-first підтверджено коректно: тимчасово відкотив `get()` до старої реалізації → тест впав (RED, "promise resolved замість reject") → відновив фікс → тест пройшов (GREEN). Перехід до фінальної ітерації 3.
