---
spec: specs/phase5/lazy-loading.md
section: L4 — i18n: файл на локаль
iter: 1
agent: Opus subagent (чистий контекст; git diff + 9 нових файлів; механічна перевірка словників у Node; запускав i18n/app/designSettingsRegistry тести)
files-reviewed:
  - client/js/i18n.js
  - client/js/locales/*.js (9 файлів)
  - client/js/app.js
  - client/tests/i18n.test.js
  - client/tests/app.test.js
  - specs/phase5/lazy-loading.md
decision: PASS_WITH_NOTES → 1 знахідка виправлена, 1 нотатка задокументована
---

# Знахідки та рішення

| # | Файл:рядок | Цитата | Суть | Рішення |
|---|---|---|---|---|
| N1 | app.js:254 | `langSelect.addEventListener("change", async () => {` | Гонка: два перемикання в польоті резолвляться не по черзі (fr→de, de.js приходить перший) → UI французькою при селекті "de"; той самий клас — стартовий catch-up проти ручного вибору | **Виправлено** — staleness-guard в обробнику (`if (langSelect.value !== next) return`) і подвійний guard у catch-up (.then перевіряє селект і що активна локаль досі en) |
| N2 | app.js:266 | `if (getLocale() !== desiredLocale) {` | Catch-up усередині `if (langSelect)` — сторінка без #lang-select лишилась би на en для лінивої збереженої локалі | **Прийнято** — недосяжно з client/index.html (елемент завжди є); нотатка тут як документація |

# Що рев'юер підтвердив як коректне

1. **Точність словників — механічно**: import старого i18n.js (HEAD) і нового поруч
   у Node, ensureLocale усіх 9 → усі 11 словників байт-у-байт ідентичні (набори
   ключів, ПОРЯДОК ключів, кожне значення). en+uk незаймані, літерал MESSAGES
   валідний, SUPPORTED_LOCALES той самий набір.
2. **ensureLocale**: кеш=promise (конкурентні перші виклики ділять один),
   retry-скидання при відмові (політика L1–L3), no-op для inline/loaded/unsupported,
   статичні специфікатори import (greppable, no-bundler-safe).
3. **app.js**: refreshAfterLocaleChange досяжний лише з post-sync шляхів (3 референси);
   failure-шлях обробника коректний (setLocale лише після успішного await);
   catch-up-guard — точно лінивий кейс, en/uk не misfire; detectLocale зберігає
   стару поведінку для сміття ("en"); pre-L4 збережене "de" підхоплюється.
4. **Blast radius**: інші згадки MESSAGES/setLocale — лише коментарі; sw.js/index.html
   без preload i18n.
5. Тести: fresh-import тест (vi.resetModules) справжньо доводить відсутність de на
   старті (RED на моноліті); waitFor-додатки обгортають лише ново-асинхронні
   асершни, синхронні сусідні лишились. Прогін рев'юера 451/451; автора — повний
   1048/1048 (після N1-фіксу).

# Жива перевірка (обидва хости, 2026-09-19, фактично виміряне)

- Холодний старт (uk): жоден `locales/*.js` не вантажиться (Resource Timing);
  i18n.js віддається ~69KB замість 321KB.
- Перемикання селектора на de: підтягується РІВНО один файл `locales/de.js`,
  статичні тексти і імперативні панелі перекладаються німецькою.
- Повернення на uk — миттєве (інлайн), консоль без помилок. Те саме на kibr.
