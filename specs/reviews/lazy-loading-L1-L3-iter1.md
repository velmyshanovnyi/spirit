---
spec: specs/phase5/lazy-loading.md
section: L1+L2+L3 — hash-wasm / bip39-словник / qrcode за запитом
iter: 1
agent: Opus subagent (чистий контекст; git diff; запускав 5 профільних сюїт + app/profile/fileTransferUI)
files-reviewed:
  - client/js/deterministicIdentity.js
  - client/js/fileTransfer.js
  - client/js/mnemonic.js
  - client/js/passwordGenerator.js
  - client/js/qr.js
  - client/js/recoveryUI.js
  - client/js/app.js
  - client/tests/qr.test.js
  - client/tests/passwordGenerator.test.js
  - client/tests/app.test.js
  - specs/phase5/lazy-loading.md
decision: PASS_WITH_NOTES → 2 нотатки, обидві виправлено
---

# Нотатки та рішення

| # | Файл:рядок | Цитата | Суть | Рішення |
|---|---|---|---|---|
| N1 | app.test.js:2968 | `expect(...value).toBe("my own chosen password");` | Guard-тест лишився синхронним при async-обробнику: перенесений за await overwrite тест би не зловив | **Виправлено** — тест async, flush через setTimeout(0), додатковий assert `generateStrongPassword` not called |
| N2 | qr.js:7 (+4 модулі) | `if (!p) p = import(...)` | Відмовлений перший import назавжди отруює кеш — кожен наступний рендер падає без retry до перезавантаження | **Виправлено** — `.catch` скидає кеш у null у всіх 5 модулях; наступний виклик повторює fetch |

# Що рев'юер підтвердив як коректне

1. **Патерн**: присвоєння кешу синхронне до першої точки призупинення — два
   конкурентні перші виклики ділять один promise, подвійного fetch немає (5 модулів).
2. **Повнота**: жодного залишкового статичного import-а трьох важких файлів у
   client/js; index.html/sw.js без preload, що зламав би лінивість.
3. **Blast radius**: усі не-тестові колсайти 6 функцій await-ять (app.js ×4,
   fileTransferUI, profile.js, recoveryUI ×2); Promise-в-DOM неможливий; мок
   із mockReturnValue(рядок) прозорий для await.
4. **Чекбокс**: guard до await, порядок незмінний; єдине нове чергування
   (check→uncheck→check в одному мікровікні) дає свіжий пароль так само —
   людина не встигає друкувати між мікрозадачами, не дефект.
5. **Non-vacuity**: обидва Promise-shape тести справжній RED на sync-API
   (`.then === undefined` у String); waitFor-додатки не маскують регресій.
6. Спека↔код 1:1 (L4 коректно відкладена). Прогони: 56/56 профільних + 429
   суміжних у рев'юера; повний прогін автора 1046/1046 (після фіксів нотаток).

# Жива перевірка (обидва хости, 2026-09-19, фактично виміряне)

- Resource Timing після холодного старту: `hash-wasm.esm.js`, `qrcode.esm.js`,
  `bip39-wordlist-en.js` ВІДСУТНІ в графі — на старті більше не вантажаться.
- Тригер фічі (генерація пароля portable-акаунта) → `bip39-wordlist-en.js`
  з'являється в графі, поле заповнюється 6-слівним паролем.
- Консоль без помилок; решта флоу неушкоджена.
