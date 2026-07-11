---
spec: identity-verification
section: A-C
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/proofs.js
  - client/js/proofSet.js
  - client/js/contacts.js
  - client/js/app.js
  - client/tests/proofs.test.js
  - client/tests/proofSet.test.js
  - client/tests/contacts.test.js
  - client/tests/app.test.js
---

## Знахідки та рішення

1. **[HIGH, ВИПРАВЛЕНО]** Канонічний payload у `proofSetPayload` (`client/js/proofSet.js`) НЕ був ін'єктивним: `${p.url}:${p.label}:${p.added_at}` з `|`-роздільником між записами дозволяв двом структурно різним спискам доказів серіалізуватись в однакові байти, коли `url`/`label` (довільний текст, URL зазвичай містить `:`) містили символи-роздільники. Продемонстровано конкретну колізію: `[{url:"u1",label:"l1",added_at:1},{url:"u2",label:"l2",added_at:2}]` і `[{url:"u1",label:"l1:1|u2:l2",added_at:2}]` серіалізуються в однакові байти й проходять один і той самий підпис. Виправлено: `proofSetPayload` тепер використовує `JSON.stringify` над масивом фіксованої форми (кожен рядок самоекранований через власне екранування лапок, тому жодна байтова послідовність не є неоднозначною між «кінець цього поля» і «початок наступного»). Покрито новим тестом "does NOT let a crafted url/label re-split into a different, still-valid set", який точно відтворює знахідку.
2. **[LOW, ВИПРАВЛЕНО]** Мертвий рядок `fields.signature = fields.signature;` у `client/js/proofs.js` (self-assignment без ефекту) — прибрано, поведінка парсера не змінилась (усі попередні тести proofs.js лишились зеленими).

## Прийнято без змін

- `verifyProofBlock` (`proofs.js`) коректно вимагає ОБИДВІ умови: `identity`-поле блоку дорівнює очікуваному контакту, І валідний підпис ключем, імпортованим саме з цього поля — немає шляху пройти без обох умов одночасно.
- Неін'єктивність канонічного payload у `proofs.js` (лише поле `statement` вільне, і воно згенероване з фіксованого шаблону) НЕ експлуатована, оскільки `statement` не контролюється атакуючим незалежно від `identity`-поля — залишено без змін.
- Дротування `proof-set-announce` в `app.js` побайтово симетричне до `device-list-announce` (той самий trust-гейт, та сама send-гейтація, коректне порівняння за посиланням `accepted !== heldSet`).
- Асиметрична null-толерантність `addProofToSet` (толерує `null`) vs `revokeProofFromSet` (кидає на `null`) — досяжна лише через безглуздий виклик «відкликати з порожнього набору»; не блокуюче, залишено без змін.

## Верифікація

Повний набір зелений після виправлень: 358/358 (`npx vitest run`).
