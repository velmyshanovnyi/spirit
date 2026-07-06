---
spec: phase2/profiles
section: "Секція 6: Відновлення профілю з backup"
iter: 1
agent: opus
files-reviewed:
  - client/js/errors.js
  - client/js/profile.js
  - client/js/keyfile.js
  - client/js/identity.js
  - client/tests/profile.test.js
  - client/tests/identity.test.js
  - client/tests/keyfile.test.js
---

## Знахідки

DER/ASN.1-конструкція в `identity.js` (мінімальний ручний PKCS8-врапер для 32-байтного P-256 скаляра), OID-байти, вкладеність структур, шляхи обробки помилок (немає плутанини між `IncorrectPassphraseError` і структурними помилками keyfile) та персистентність (незалежний `loadPermanentProfile` після відновлення) — усе перевірено побайтово й підтверджено коректним.

**1 реальна знахідка (низька критичність)**: `client/js/identity.js` — `exportPrivateKeyScalar` не перевіряв довжину декодованого скаляра (32 байти), на відміну від свого пари `importPrivateKeyFromScalar`, яка суворо це перевіряє. Специфікація RFC 7518 §6.2.2.1 гарантує left-padding JWK `d` до розміру поля кривої, тож на практиці це не проявляється, але асиметрія — прихована прогалина: неконформна реалізація дала б незрозумілу помилку "Invalid entropy length" з `bytesToMnemonic` замість чіткої помилки в місці справжньої причини.

## Виправлення

Додано ідентичну перевірку довжини (32 байти) у `exportPrivateKeyScalar`, дзеркально до `importPrivateKeyFromScalar`.

## Статус

Виправлено, потребує ітерації 2 для підтвердження.
