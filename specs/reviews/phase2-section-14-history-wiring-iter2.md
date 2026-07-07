---
spec: phase2/history-sync-accounts
section: "Секція 14: Дротування історії в чат-UI"
iter: 2
agent: opus
files-reviewed:
  - client/js/profile.js
---

## Знахідки

Немає нових. Фікс підтверджено повним:

- Очищення в `persistRawIdentity` — єдиній точці всіх fresh-salt шляхів (`createPermanentProfile`, `adoptIdentity`, і через нього restore/link);
- `loadPermanentProfile` (та сама збережена сіль) коректно НЕ очищує — розблокування зберігає валідну історію;
- Порядок put→clear правильний: зворотний мав би строго гірший режим часткової відмови (знищення історії чинного профілю при невдалому put); як є — невдалий clear лишає stale-рядки, які прибере наступний persist, а vaultKey повертається лише після успішного clear.

## Статус

**Конвергенція досягнута.** Секція 14 готова до коміту.
