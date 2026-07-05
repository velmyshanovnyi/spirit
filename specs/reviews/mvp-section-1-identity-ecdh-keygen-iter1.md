---
spec: phase1/mvp
section: "Секція 1: Identity та ECDH keygen (клієнт)"
iter: 1
agent: opus
files-reviewed:
  - client/js/identity.js
  - client/tests/identity.test.js
---

## Знахідки

1. **`importPrivateKeyRaw` хардкодив `extractable: true`** (identity.js:23, `return crypto.subtle.importKey("pkcs8", rawKey, algorithm, true, usages);`) — відновлений ключ лишався re-exportable без потреби, зайве розширення поверхні атаки. Виправлено: параметр `extractable = false` за замовчуванням.
2. **Гілка імпорту ECDH не була покрита тестами** (identity.js:22) — ризик мовчазної плутанини ECDSA/ECDH типів через ідентичний pkcs8-формат P-256. Виправлено: доданий round-trip тест ECDH-пари з перевіркою `deriveBits`.
3. (Незначне) **`fingerprint`-тест не перевіряв довжину дайджесту** — регресія усічення могла пройти непоміченою. Виправлено: додано `toHaveLength(64)`.

## Статус

Усі три знахідки виправлені в тому ж коміті. Перехід до ітерації 2 для підтвердження конвергенції.
