---
spec: phase2/history-sync-accounts
section: "Секція 12: Автентифікований identity-announce у хендшейку"
iter: 1
agent: opus
files-reviewed:
  - client/js/identityAnnounce.js
  - client/js/contacts.js
  - client/js/app.js
  - client/tests/identityAnnounce.test.js
  - client/tests/contacts.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає проти імплементації. Перевірено побайтово п'ять напрямів:

1. **Session binding / echo** — дзеркальний payload коректний: легітимний peer B верифікує підпис A над `(pubA, ecdhA, ecdhB)`; echo назад до A перевіряється проти `(pubA, ecdhB, ecdhA)` — mismatch, відхиляється; MITM з двома окремими хендшейками має різні wire-ключі на кожному плечі — transplant неможливий. `|`-роздільник відсутній у base64 — payload ін'єктивний.
2. **Identity-swap посеред сесії** — другий валідний announce може створити лише той самий session-bound peer; перезапис `peerFingerprint` безпечний (попередження про зміну fingerprint — nice-to-have, не дефект).
3. **Stale wires** — недосяжно: чат-входи скидають `peerFingerprint`/`sessionEcdhWires`, wires виставляються за рядок до `sessionKey`, guard `!state.sessionKey` у onMessage; device-link флоу не використовують `handleChatMessage`.
4. **Вихідний текст не гейтується** — узгоджено з моделлю загроз docs/e2ee.md (відправник сам обирає, кому шле; канал усе одно E2EE).
5. **Тести** — реальна крипто, невакуумні; app-тести пінять точний дзеркальний порядок аргументів, ephemeral-vs-profile персистенцію та гейтування.

**Прогалина покриття** (не дефект): reflection-кейс з тими САМИМИ ключами не був запінений явно (transplant-тест використовує чужі ключі).

## Виправлення

Додано тест "rejects our OWN announce echoed back to us (reflection attack)".

## Статус

**Конвергенція досягнута з першої ітерації** (правка — лише додатковий тест за зауваженням покриття). Секція 12 готова до коміту.
