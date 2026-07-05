---
spec: phase1/mvp
section: "Секція 5: Мінімальний UI (wiring)"
iter: 2
agent: opus
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - client/js/identity.js
---

## Знахідки

**Підтверджено активною (не re-raise — ітерація 1 явно попросила перевірити цей шлях)**: знахідка 5 (витік ICE-таймера) досі жива. Якщо внутрішній IIFE `startAsInitiator`/`startAsJoiner` падає до виклику `onLocalOfferReady`/`onLocalAnswerReady` (наприклад, `createOffer`/`setLocalDescription` кидає виняток усередині webrtc.js), `onError` виставляє статус помилки, але `disarmIceTimeout` ніколи не викликається — застарілий 15с таймер пізніше перезаписує реальну помилку загальним повідомленням тайм-ауту.

Підтверджено коректними (без змін): подвійний тайм-аут (ICE + очікування відповіді) не конфліктує; внутрішній try/catch у `onLocalOfferReady` дійсно необхідний (зовнішній catch у `withBusyButton` не може перехопити виняток з відв'язаного колбека); знахідки 2, 4, 7 — виправлені коректно; `btn-join` законно не потребує тайм-ауту очікування відповіді (немає polling-циклу).

**Нове (прогалини покриття тестів)**: жоден тест не перевіряв внутрішній try/catch у `onLocalOfferReady` (лише зовнішній `withBusyButton`-catch), жоден тест не перевіряв шлях витоку таймера через `onError`, `btn-join` не мав жодного тесту.

## Статус

Виправлено: `wireChannelCallbacks` тепер приймає `disarmIceTimeout` і викликає його всередині `onError`. Додано тести на: витік таймера через `onError`, внутрішній error boundary в `onLocalOfferReady`, повний щасливий шлях `btn-join`, guard на відсутній акаунт для `btn-join`. Перехід до ітерації 3 (фінальної за лімітом).
