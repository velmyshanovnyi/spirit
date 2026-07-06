---
spec: phase2/profiles
section: "Секція 5: Backup — keyfile"
iter: 1
agent: opus
files-reviewed:
  - client/js/keyfile.js
  - client/tests/keyfile.test.js
  - client/js/vault.js
  - client/js/profile.js
---

## Знахідки

1. **[Must-fix] Зламаний тест-assertion** — порівнював `ciphertext` одного keyfile із `salt` іншого (семантично непов'язані значення), тривіально true, нічого не тестує. Виправлено: заміна на змістовну перевірку свіжості (два keyfile для того самого ключа+passphrase мають різні `salt` і `ciphertext`).
2. **[Must-fix] Асиметрична обробка невалідного base64 у `salt`** — пошкоджений (але рядковий) `salt` вислизав з try/catch навколо розшифрування, пропускаючи сирий `InvalidCharacterError` замість "malformed keyfile". Виправлено: окремий try/catch навколо `base64ToBytes(keyfile.salt)`, що явно повертає структурну помилку "Unsupported or malformed keyfile format" до спроби деривації/розшифрування.
3. **[Design note, відкладено до Секції 6]** Окремий клас `IncorrectKeyfilePassphraseError` (замість перевикористання `IncorrectPassphraseError` з `profile.js`) — правильне рішення проти циклічного імпорту (Секція 6 з'єднає обидва модулі), але майбутній UI-шар матиме два catch-блоки. Пропозиція — спільний `client/js/errors.js`, коли модулі реально зійдуться в Секції 6.
4. Підтверджено коректним: сувора версія формату (нема попередніх версій), перевикористання `vault.js` без розбіжності параметрів, round-trip і "не містить plaintext" тести — змістовні, хоч другий і не є строгим доказом відсутності витоку.

## Статус

Знахідки 1, 2 виправлені. Перехід до ітерації 2.
