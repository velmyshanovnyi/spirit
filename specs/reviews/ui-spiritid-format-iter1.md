---
spec: ui/redesign-i18n
section: "Секція U4: Формат відображуваного Spirit ID (префікс spirit0001)"
iter: 1
agent: opus
files-reviewed:
  - client/js/spiritId.js
  - client/js/app.js
  - client/tests/spiritId.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає. Перевірено:

- Усі call-sites `formatSpiritId` — виключно display-записи (pub-key-display, peerVerified-статус, label опції селектора); жоден внутрішній шлях не отримує форматований id.
- Простежено кожне використання `state.senderKey`: встановлюється лише з сирих джерел; усі споживачі протоколу/сховища (history, deviceList-ключі, createInvite, session senderKey, Google nonce) отримують сирий fingerprint — витоку форматованої форми немає.
- `parseSpiritId` строгий lowercase-hex — коректно для v1 (fingerprints lowercase; споживача поки немає, тести пінять контракт).
- 25 оновлених тестових перевірок — послідовно один префікс, без пропусків; перевірки внутрішніх значень коректно лишилися сирими.

## Статус

**Конвергенція досягнута з першої ітерації.** Секція U4 готова до коміту.
