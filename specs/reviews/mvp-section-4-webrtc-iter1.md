---
spec: phase1/mvp
section: "Секція 4: WebRTC-оркестрація"
iter: 1
agent: opus
files-reviewed:
  - client/js/webrtc.js
  - client/tests/webrtc.test.js
---

## Знахідки

1. **Відсутній `.catch` на async IIFE** (`startAsInitiator`/`startAsJoiner`) — відхилення `createOffer`/`setLocalDescription`/`setRemoteDescription`/`createAnswer` губилось як unhandled rejection, хендшейк мовчки зависав. Виправлено: доданий `onError` callback, обидва IIFE обгорнуті в try/catch.
2. **Немає тайм-ауту очікування завершення ICE-gathering** — якщо кандидат `null` ніколи не прийде (немає STUN/TURN), `onLocalOfferReady`/`onLocalAnswerReady` ніколи не спрацюють. **Відкладено** до Секції 5 (UI-рівень володіє станом "не вдалося з'єднатись"/спінером) — явно затрековано в `specs/phase1/mvp.md`, Секція 5.
3. **Ініціатор не мав явного способу застосувати отриману відповідь (answer)** — виправлено: доданий експортований `applyRemoteAnswer(pc, answerSdp)`.
4. Присвоєння `pc.onicecandidate = ...` замість `addEventListener` — не проблема для цього скоупу (єдиний власник щойно створеного `pc`).
5. Тест не перевіряє порядок "null-кандидат не може прийти раніше, ніж `localDescription` встановлено" — **dismissed**: специфікація WebRTC гарантує, що ICE-gathering починається лише як побічний ефект `setLocalDescription`, тож у сумісному браузері ця гонка структурно неможлива (не здогадка, а гарантія специфікації).
6. Невикористане scaffolding у fake (`send`, `remoteDescription`) — не проблема.

## Статус

Знахідки 1 і 3 виправлені в тому ж коміті, знахідка 2 явно відкладена й затрекована, знахідка 5 dismissed з обґрунтуванням. Перехід до ітерації 2.
