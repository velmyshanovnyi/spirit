---
spec: phase1/mvp
section: "Секція 2: E2EE (ECDH → HKDF → AES-GCM)"
iter: 1
agent: opus
files-reviewed:
  - client/js/e2ee.js
  - client/tests/e2ee.test.js
---

## Знахідки

1. **HIGH: переповнення стека аргументів на великих повідомленнях** (e2ee.js:41, `return btoa(String.fromCharCode(...combined));`) — спред великого typed array як окремих аргументів функції перевищує ліміт рушія (RangeError: Maximum call stack size exceeded) для повідомлень уже в десятки КБ. Той самий патерн дублювався в tamper-тесті. Виправлено: додано `bytesToBase64`/`base64ToBytes` з чанкованим (0x8000 байт) кодуванням, тест на 300 000-символьне повідомлення підтверджує фікс (спершу відтворив RED з `RangeError`).
2. **MEDIUM (опційно, не виправлено): відсутня явна перевірка довжини перед розрізанням iv/ciphertext** у `decryptMessage` — при пошкодженому/обрізаному payload GCM все одно відхилить із непрозорим `OperationError` (fail-closed, без наслідків для безпеки). Залишено як низькопріоритетне майбутнє покращення.

## Статус

Знахідка 1 виправлена в тому ж коміті. Перехід до ітерації 2 для підтвердження конвергенції.
