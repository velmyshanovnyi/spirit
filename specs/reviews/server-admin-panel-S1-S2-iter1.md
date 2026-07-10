---
spec: ui/server-admin-panel
section: "Секції S1 (серверні дії) + S2 (клієнтський UI)"
iter: 1
agent: opus
files-reviewed:
  - server/config.php
  - server/library/SignalingController.php
  - client/js/adminAuth.js
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/adminAuth.test.js
  - client/tests/app.test.js
---

## Знахідки

Немає блокуючих. Побайтово перевірено конструкцію токена (`issueAdminToken`/`verifyAdminToken`) на підробку/timing-канали, порядок dispatch (short-circuit до sender_key/whitelist — без колізій з іменами інших дій, CORS/OPTIONS не зачеплено), витік інформації через 11 полів білого списку (прийнятно — жодних шляхів файлів, whitelist, хешу/секрету), клієнтський interleaving при відмові другого запиту (`getAdminConfig`) після успішного логіну (пароль очищується ДО другого виклику — коректно за будь-якого результату).

**Дві нефатальні знахідки**:

1. **Спільний секрет між вузлами** (`server/config.php`) — той самий `ADMIN_PASSWORD_HASH`+`ADMIN_TOKEN_SECRET` задеплоєний ідентично на kolomedi й kibr; токен, виданий на одному вузлі, валідний і на іншому (самодостатній токен не містить ідентифікатора вузла). Прийнятний ризик на dev-фазі (read-only, низька цінність, механізм ротації пароля вже заплановано окремо) — задокументовано explicit-коментарем у конфізі.
2. **Прогалина покриття** (`client/tests/app.test.js`) — тест успішного логіну перевіряв лише 3 змоковані поля, не підтверджуючи явно, що клієнт відкидає невідомі/чутливі поля з відповіді сервера (сам код уже це робить через whitelist `ADMIN_CONFIG_FIELDS` — захист є, тест його не фіксував).

## Виправлення

Додано тест "only ever renders whitelisted fields..." — підсовує `db_file`/`admin_password_hash` у мокову відповідь, підтверджує їх відсутність у рендері (пройшов одразу, підтверджуючи вже коректний захист). Коментар у `config.php` розширено explicit-приміткою про спільний секрет і прийнятність ризику.

## Статус

**Конвергенція досягнута з першої ітерації.** Секції S1+S2 готові до коміту.
