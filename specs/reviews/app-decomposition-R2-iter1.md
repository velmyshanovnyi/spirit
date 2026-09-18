---
spec: specs/phase5/app-decomposition.md
section: R2 — mesh-реле (GC4) → client/js/groupMesh.js
iter: 1
agent: Opus subagent (чистий контекст; git diff + нові файли; запускав groupMesh/app тести)
files-reviewed:
  - client/js/groupMesh.js
  - client/js/app.js
  - client/tests/groupMesh.test.js
  - specs/phase5/app-decomposition.md
decision: PASS_WITH_NOTES → 0 знахідок, 1 нотатка (без змін коду)
---

# Знахідки

Жодної знахідки, що відповідає бару доказовості.

# Нотатка

groupMesh.test.js:23 — groupId-скоупінг у тесті relayGroupMeshMessage забезпечує
фейковий `getGroupPeerByFingerprint` з harness-а, тож тест доводить коректну
*делегацію*, а не сам інваріант скоупінгу. Реальний інваріант покритий
GC4-сценаріями app.test.js (справжня імплементація lookup-а лишилась в app.js).
Прийнято без змін.

# Що рев'юер підтвердив як коректне (по осях завдання)

1. **Verbatim-еквівалентність**: мультимножинне порівняння 209 видалених рядків проти
   groupMesh.js:32–242 — єдина дельта, крім задекларованої (шапка, 3 імпорти, обгортка,
   return-блок), відсутня; жоден рядок тіла не змінено.
2. **Вільні змінні**: всі не-локальні символи — 9 імпортів з тих самих модулів-джерел
   або 8 ін'єктованих параметрів; `state.senderKey`/`state.identityKeyPair` — через
   ін'єктований об'єкт; жодного тихого захоплення глобалу.
3. **TDZ/порядок**: усі 7 функцій-залежностей — hoisted declarations до колсайту 3073;
   4 деструктуровані const вживаються лише в тілі `handleChatMessage` (виконується
   після init); синхронного pre-init шляху не існує.
4. **Семантика спільного стану**: dispatch-lock танець onMessage (серіалізація через
   `state.messageDispatchLock`, save/restore `activeConnectionId`, `finally`) —
   байт-у-байт ідентичний; нових полів state немає.
5. **Імпорти app.js**: усі 9 e2ee/webrtc/identity символів мають ≥1 вживання поза
   import-рядком — нічого не звисає і нічого потрібного не видалено.
6. Тести: groupMesh 3/3 (mock e2ee робить re-encryption спостережуваним); app.test.js
   диффом не зачеплений; повний прогін 1036/1037 (єдине падіння — A10-флейк Argon2
   profile.test.js, ізольовано 30/30).

# Жива перевірка (обидва хости, 2026-09-18, фактично виміряне)

- Деплой `js/app.js` + `js/groupMesh.js`; байтові розміри локально == HTTP (no-store).
- kolomedi і kibr: застосунок вантажиться, `groupMesh.js` присутній у графі модулів
  (Resource Timing), консоль без помилок. Mesh-флоу «3 учасники через реле» наживо в
  цій сесії не проганявся (потребує 3 незалежних профілів; behavior-preserving
  екстракція + GC4-сценарії app.test.js прийнято як достатнє покриття — той самий
  рівень, що й R1).
