---
spec: phase2/profiles
section: "Секція 9: Мультипристрій — flow приєднання пристрою"
iter: 1
agent: opus
files-reviewed:
  - client/js/deviceLinking.js
  - client/js/profile.js
  - client/js/app.js
  - client/js/identity.js
  - client/js/codec.js
  - client/tests/deviceLinking.test.js
  - client/tests/profile.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає блокуючих. Перевірено шість напрямів:

1. **Порядок валідації в `applyLinkGrant`** — жодного запису до проходження всіх перевірок (shape → прив'язка до ВЛАСНОГО device-ключа → верифікація сертифіката); base64-порівняння SPKI канонічне (обидві сторони — той самий WebCrypto-експорт + той самий кодек; P-256 SPKI DER фіксований).
2. **Атакерський request у `createLinkGrant`** — ескалації немає: будь-який валідний P-256 ключ дає лише device-сертифікат (окремий клас креденшела); передача identity авторизована самим володінням одноразовим invite (документована модель); сміттєві ключі відхиляє `importKey`.
3. **UI-обробники** — витоки помилок з detached-колбеків ловляться try/catch у `wireChannelCallbacks.onMessage`; фільтрація за `message.type` виключає крос-ток чату й linking; `maybeSendLinkRequest` одноразовий і коректний для обох порядків (канал/session key).
4. **Вірність рефакторингу** — статуси, AbortController-таймаут, порядок disarm ICE збережені байт-у-байт для чат-шляхів.
5. **`exportRawIdentity`** — без послаблення vault-контракту: той самий passphrase-гейт, без кешування; DOM-поле очищується.
6. **Тести** — сигнатури моків збігаються з реальними контрактами; перевірки предметні (реальний sign/verify крос-чек).

Зафіксовано як pre-existing (не нове в цій секції): кнопка primary re-enable до завершення fire-and-forget сесії (ідентично `btn-initiate`); повторний grant повторив би `applyLinkGrant` ідемпотентно (документована overwrite-семантика).

## Статус

**Конвергенція досягнута з першої ітерації.** Секція 9 готова до коміту.
