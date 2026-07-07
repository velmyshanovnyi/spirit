---
spec: phase2/history-sync-accounts
section: "Секція 13: Транспорт device-списку контактам"
iter: 1
agent: opus
files-reviewed:
  - client/js/deviceLinking.js
  - client/js/contacts.js
  - client/js/app.js
  - client/tests/deviceLinking.test.js
  - client/tests/contacts.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає. Перевірено п'ять напрямів:

1. **Арифметика версій `appendDeviceToList`** — вхід лише з власної db (довірений); дублікат сертифіката при повторному прив'язуванні того самого пристрою — не hazard: `revokeDevice` видаляє ВСІ сертифікати ключа (запінено Секцією 10).
2. **Порядок надсилання** — identity announce → device list, послідовно на впорядкованому WebRTC-каналі; guard отримувача задоволений до приходу списку.
3. **Stale `peerIdentityPublicKey`** — недосяжний: гілка списку гейтована на `peerFingerprint`, який скидається на новий чат і виставляється лише свіжим верифікованим announce, що перезаписує обидва поля одним блоком.
4. **Throw-шлях `updateContactDeviceList`** — недосяжний у флоу: та сама vault-гейтка гарантує, що `rememberContact` виконався до приходу списку в профільному режимі; ефемерний повертається раніше.
5. **Mock-reality drift** — контракт reference-equality "no change" реальний: `acceptNewerDeviceList` повертає `current` verbatim без оновлення; гейт `accepted !== heldList` коректний.

## Статус

**Конвергенція досягнута з першої ітерації.** Секція 13 готова до коміту.
