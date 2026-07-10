---
spec: ui/multi-screen
section: "Секції N2 (міграція екранів), N3 (контакти), N4 (історія)"
iter: 1
agent: sonnet
note: "Opus-субагент недоступний (тижневий ліміт, відновлення 2026-07-10 23:00 Europe/Kiev) — review проведено поточною робочою моделлю (Sonnet) за узгодженням з користувачем, за тими самими критеріями суворості."
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/js/contacts.js
  - client/js/historyStore.js
  - client/tests/app.test.js
  - client/tests/contacts.test.js
  - client/tests/historyStore.test.js
---

## Знахідки

Немає. Перевірено п'ять напрямів:

1. **Два незалежні hashchange-listener'и** (router.js внутрішній + app.js власний для contacts/history) — обидва лише читають `location.hash`, не залежать від виводу одне одного; порядку-залежного race немає. Живо перевірено кліком по nav-item "Контакти" в preview — список коректно рендериться.
2. **Повнота авто-навігації** — усі 4 місця встановлення identity покриті (quick-chat→room, unlock→profile, backup-skip→profile, device-join-grant→profile); `restoreProfileFromMnemonic/Keyfile` підтверджено не підключені до жодної UI-кнопки взагалі (наявна прогалина, не внесена цією секцією).
3. **Витік vaultKey між режимами** — кожне місце встановлення identity повністю ЗАМІНЮЄ `state.identityKeyPair` новим об'єктом (не мутує), тож застарілий vaultKey з попереднього профілю не може пережити перехід у ефемерний режим.
4. **Парсинг ключів у `listConversations`** — безпечний за побудовою: єдиний writer у стор "messages" — `historyStore.js`'s власний `messageKey()`, fingerprint завжди 64-символьний hex (без двокрапок), той самий інваріант, на який вже покладається `listMessages` із Секції 15.
5. **Невакуумність тестів** — два навігаційні тести (chat → conversation, device-linking → залишається) справді проходять різними шляхами коду: чат-флоу передає `afterChannelOpen` з `router.navigate`, device-linking-флоу цього ключа взагалі не має в `channelOptions`.

Живо перевірено в preview (screenshot-інструмент завис цю сесію — перевірка через DOM eval + accessibility snapshot + CSS inspect): дефолтний екран "account"; gated-редірект без identity; quick-chat генерує реальний ключ і переходить на "room" з Spirit-ID-форматованим fingerprint; contacts-екран коректний empty-state; desktop-nav — fixed sidebar, mobile-nav — sticky tab-bar (7 елементів спричиняють горизontal-scroll на 375px — прийнятний UX-компроміс).

## Статус

**Конвергенція досягнута з першої ітерації** (Sonnet-review за узгодженням з користувачем через недоступність Opus). Секції N2-N4 готові до коміту. Рекомендовано за наявності Opus-квоти (після 2026-07-10) провести додатковий контрольний прохід — не обов'язково перед комітом, оскільки review вже пройшов з тією ж суворістю критеріїв.
