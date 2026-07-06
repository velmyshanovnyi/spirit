---
spec: phase2/profiles
section: "Секція 3: Модель профілю (створення/завантаження перманентного профілю)"
iter: 1
agent: opus
files-reviewed:
  - client/js/profile.js
  - client/tests/profile.test.js
  - client/js/db.js
  - client/js/vault.js
  - client/js/identity.js
---

## Знахідки

Немає блокуючих. Обидва перенесені з Секції 2 пункти підтверджено закритими:
- **Персистентність солі**: `loadPermanentProfile` завжди перевикористовує збережену сіль, немає жодного шляху до регенерації — простежено покроково.
- **Domain-error замість сирого DOMException**: `IncorrectPassphraseError` коректно обгортає лише саме розшифрування (bare `catch` містить один виклик, не ширший блок, що міг би замаскувати непов'язаний баг).
- **Подвійний імпорт приватного ключа** (extractable → похідний публічний → non-extractable фінальний) — підтверджено необхідним, не over-engineering: `derivePublicKeyFromPrivate` вимагає extractable, повернений ключ має бути non-extractable; Web Crypto не має операції "downgrade" екстрактивності.

Незначні пункти, виправлені одразу:
1. Загальна `Error("No permanent profile...")` неконсистентна з підходом domain-errors — додано `NoStoredProfileError`.
2. Поріг "третій споживач codec" (зі спеки Секції 5) вже досягнутий (`identity.js`, `googleOAuth.js`, `vault.js`, тепер `profile.js`) — винесено `bytesToBase64`/`base64ToBytes` у нейтральний `client/js/codec.js` одразу, не відкладаючи до Секції 5.
3. Додано доккоментар про неідемпотентність `createPermanentProfile` (невдалий `put` губить згенерований, але не збережений ключ — наступна спроба згенерує ІНШУ ідентичність).

## Статус

Виправлення застосовані, перехід до ітерації 2 (перевірка codec-рефакторингу + фіксів).
