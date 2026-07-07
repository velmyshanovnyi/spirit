---
spec: phase2/history-sync-accounts
section: "Секція 14: Дротування історії в чат-UI"
iter: 1
agent: opus
files-reviewed:
  - client/js/app.js
  - client/js/profile.js
  - client/js/historyStore.js
  - client/tests/app.test.js
  - client/tests/profile.test.js
---

## Знахідки

**1 знахідка (Medium)**: `client/js/historyStore.js:38` — `const keys = (await listKeys("messages")).filter((key) => key.startsWith(prefix)).sort();` — застарілі рядки історії попереднього профілю (записані під vault-ключем, який після restore/adopt/create безповоротно замінений свіжою сіллю) лишаються в сторі, `listMessages` кидає AES-GCM OperationError на легітимно відновленому профілі, і announce-обробник помирає посеред флоу з хибним повідомленням про помилку. Найімовірніший тригер — повторне відновлення тієї самої identity.

Чисте (без знахідок): паритет помилок restore-функцій після маршрутизації через `adoptIdentity`; реальний ланцюжок vaultKey до прив'язаного пристрою через `applyLinkGrant`; persist-після-показу для обох напрямів; best-effort interleaving history-рендера (задокументований MVP-компроміс).

Прогалину Секції 11 (vaultKey після restore/adopt) закрито коректно.

## Виправлення

Очищення стора `messages` при кожному persist зі свіжою сіллю; на ітерації 2 також виявлено й закрито той самий баг у `createPermanentProfile` — очищення перенесено в спільний `persistRawIdentity` (єдина точка всіх fresh-salt шляхів). Два RED→GREEN тести.

## Статус

Виправлено, ітерація 2 підтверджує.
