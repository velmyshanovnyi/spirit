---
spec: phase1/mvp
section: "Секція 1: Identity та ECDH keygen (клієнт)"
iter: 2
agent: opus
files-reviewed:
  - client/js/identity.js
  - client/tests/identity.test.js
---

## Знахідки

Немає нових. Усі три знахідки з ітерації 1 підтверджено виправленими:

1. `extractable = false` за замовчуванням у `importPrivateKeyRaw`, підтверджено тестом `restores a non-extractable key by default`.
2. ECDH round-trip тест покриває раніше непокриту гілку, підтверджує `algorithm.name === "ECDH"` і збіг спільного секрету до/після відновлення.
3. `fingerprint`-тест перевіряє довжину дайджесту (64 hex-символи).

Новий дефолт `extractable: false` перевірено як безпечний: відновлений ключ використовується лише для криптографічних операцій (sign/deriveBits), ніколи не ре-експортується — сценарій backup/restore вже має сирі pkcs8-байти окремо.

## Статус

**Конвергенція досягнута.** Секція 1 готова до коміту.
