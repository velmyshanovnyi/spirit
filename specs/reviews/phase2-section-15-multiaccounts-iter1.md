---
spec: phase2/history-sync-accounts
section: "Секція 15: Мультиакаунти в UI"
iter: 1
agent: opus
files-reviewed:
  - client/js/profile.js
  - client/js/historyStore.js
  - client/js/app.js
  - client/index.html
  - client/tests/profile.test.js
  - client/tests/historyStore.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає. Перевірено п'ять напрямів:

1. **Атомарність lazy-міграції** — crash між put/remove лишає два байт-ідентичні записи; повторний unlock legacy-ключа ідемпотентно домігровує; confusing-but-harmless.
2. **Фільтрація listProfiles** — `deviceList:<id>` коректно виключені префіксом; жодних колізій ключів.
3. **Глобальні контакти між профілями** — реальний латентний privacy-нюанс: `snapshotContacts` при прив'язці пристрою надсилає ВЕСЬ contacts-стор, включно з контактами інших профілів. Наразі низька критичність (немає contacts-UI; linking passphrase-гейтований на власний пристрій; контакти — TOFU-реєстр, не секрети). Зафіксовано як cross-cutting питання на майбутнє (per-profile contact scoping), не блокер Секції 15.
4. **Ephemeral senderKey** — не досягає profile-неймспейснутого сховища: записи історії гейтовані на vaultKey; `randomSenderKey()` лінковки — локальна змінна, не `state.senderKey`.
5. **Вірність тестів** — `plantLegacyRecord` відтворює точну продакшн-форму запису до Секції 15; дрейфу моків немає.

Додатково: живий браузерний smoke-тест — створення профілю (реальний PBKDF2 600k) → fingerprint у селекторі → reload → розблокування passphrase-ом → той самий fingerprint, поле очищене.

## Статус

**Конвергенція досягнута з першої ітерації.** Секція 15 готова до коміту. Фаза 2 завершена повністю.
