# Спека: Реальний відеодзвінок (N5 follow-up)

Заміна каркасу Секції N5 (`specs/ui/multi-screen.md`) на робочий getUserMedia + media-tracks + перепогодження. Кнопки дзвінка/камери/мікрофона на екрані «Розмова» стають функціональними.

## Технічні рішення (узгоджено з користувачем)

- **Перепогодження (renegotiation) через зашифрований DataChannel, не сигнальний сервер**: коли чат уже з'єднаний, додавання медіа-треків потребує нового SDP offer/answer — але не нової кімнати. Новий offer/answer — це просто ще одне control-повідомлення на тому ж каналі (як `identity-announce`/`device-list-announce`), зашифроване тим самим сесійним ключем. Жодних нових серверних дій, жодного нового invite-флоу.
- **Авто-прийом дзвінка (MVP)**: отримання `webrtc-call-offer` автоматично запитує `getUserMedia`, додає власні треки у відповідь і надсилає `webrtc-call-answer`. Без екрана "вхідний дзвінок / прийняти/відхилити" — це майбутнє UX-покращення, не в цьому обсязі.
- **ICE для renegotiation не чекаємо**: додаткові медіа-треки на вже встановленому з'єднанні зазвичай не потребують нових ICE-кандидатів (той самий шлях). Offer/answer надсилаються одразу після `setLocalDescription`, без ICE-gathering-таймауту (на відміну від початкового text-chat хендшейку).
- **`pc.ontrack` реєструється завжди** (при створенні `RTCPeerConnection` в `startAsInitiator`/`startAsJoiner`), а не лише в момент кліку "Дзвінок" — вхідний трек може прийти першим, якщо співрозмовник ініціює дзвінок.
- **Камера/мікрофон за замовчуванням увімкнені** при старті дзвінка (обидва запитуються разом); кнопки-перемикачі лише вимикають/вмикають вже отримані треки (`track.enabled`), не роблять повторний `getUserMedia`.
- **Локальне відео завжди muted** (уникнення відлуння), віддалене — ні.

## Секція V1: `webrtc.js` — медіа-треки, перепогодження, вхідні треки

- [x] **Tests**: `client/tests/webrtc.test.js` (доповнення, fake `RTCPeerConnection` розширено підтримкою `addTrack`/`ontrack`/повторного `createOffer`) — `addLocalMediaTracks(pc, stream)` викликає `pc.addTrack` для кожного треку; `createRenegotiationOffer(pc)` викликає `createOffer`+`setLocalDescription`, повертає SDP БЕЗ очікування ICE-gathering; `createRenegotiationAnswer(pc, offerSdp)` — `setRemoteDescription`+`createAnswer`+`setLocalDescription`; `applyRenegotiationAnswer(pc, answerSdp)` — `setRemoteDescription`; `onRemoteTrack`-колбек, переданий у `startAsInitiator`/`startAsJoiner`, викликається при `pc.ontrack` з отриманим `MediaStream`.
- [x] **Impl**: `client/js/webrtc.js` (нові експорти; `onRemoteTrack` — новий опційний колбек в опціях `startAsInitiator`/`startAsJoiner`, вайриться в `pc.ontrack` одразу при створенні `pc`).
- [x] **Exec review**: iter1 — `specs/reviews/video-call-V1-V2-iter1.md`, зійшовся, реальних знахідок для V1 немає (обидві знахідки про V1-тест дисмісні).

## Секція V2: UI-дротування дзвінка

- [x] **Tests**: `client/tests/app.test.js` (доповнення, fake `getUserMedia`/`MediaStream`/track) — кнопки дзвінка/камери/мікрофона активуються (не `disabled`) після встановлення чат-з'єднання; клік «Дзвінок» — `getUserMedia`, локальне відео отримує `srcObject`, надсилається зашифрований `webrtc-call-offer`; отримання `webrtc-call-offer` автоматично відповідає `getUserMedia`+`webrtc-call-answer`; отримання `webrtc-call-answer` застосовує його через `applyRenegotiationAnswer`; вхідний трек (`onRemoteTrack`) встановлює `srcObject` віддаленого відео; кнопка «Камера»/«Мікрофон» перемикає `track.enabled` без повторного `getUserMedia`; `getUserMedia`-помилка (відмова дозволу) → статус, не крах.
- [x] **Impl**: `client/index.html` (справжні `<video id="video-local" muted>`/`<video id="video-remote">` замість текстових плейсхолдерів; кнопки без `disabled`), `client/js/app.js` (обробники дзвінка/камери/мікрофона, нові типи control-повідомлень `webrtc-call-offer`/`webrtc-call-answer` у `CONTROL_MESSAGE_TYPES`/`handleChatMessage`), `client/js/i18n.js` (за потреби нові статуси, напр. "камера/мікрофон недоступні").
- [x] **Exec review**: iter1 — `specs/reviews/video-call-V1-V2-iter1.md`, зійшовся після 2 виправлень (gate на `peerFingerprint` для вхідних call-offer; disable кнопок + stop треків при закритті каналу).

## Верифікація

V1 — test-first, fake `RTCPeerConnection`/`MediaStream` (jsdom не має реального WebRTC/media, як і для решти `webrtc.test.js`). V2 — test-first із моками `navigator.mediaDevices.getUserMedia`. Фінал: жива перевірка користувачем (два реальні браузери/вкладки з реальними камерами) — аналогічно живому тесту мультипристрою й invite-link.
