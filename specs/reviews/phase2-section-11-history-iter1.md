---
spec: phase2/history-sync-accounts
section: "Секція 11: Vault-сесія та зашифроване сховище історії"
iter: 1
agent: opus
files-reviewed:
  - client/js/historyStore.js
  - client/js/profile.js
  - client/js/vault.js
  - client/js/db.js
  - client/tests/historyStore.test.js
  - client/tests/profile.test.js
---

## Знахідки

Немає блокуючих. Перевірено: рефакторинг форми повернення profile.js не зламав жодного наявного споживача (spread зберігає publicKey/privateKey, vaultKey — інертне додаткове поле); схема ключів записів безпечна для 64-символьних hex-fingerprint (роздільник `:` додається до префікса — колізія префіксів між різними contactId неможлива); свіжий IV на кожен запис; wrong-key → throw (запінено тестами); fixed-width zero-pad робить лексикографічний порядок хронологічним (запінено пасткою "999 vs 1000"); probe "plaintext не з'являється" валідний для реального base64-формату ciphertext.

**Перенесено до Секції 14 (обов'язково)**: `adoptIdentity`/`restoreProfileFrom*` досі повертають keyPair БЕЗ vaultKey (відкидають значення, яке `persistRawIdentity` тепер повертає) — пристрій після link/restore опиниться в сесії з `vaultKey === undefined`, і дротування історії впаде на `appendMessage(undefined, ...)`. Закрити при дротуванні.

## Статус

**Конвергенція досягнута з першої ітерації.** Секція 11 готова до коміту.
