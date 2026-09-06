# Runbook: перенесення стану Claude Code у папку проєкту

> **Застосовано в цьому репозиторії** 2026-09-06 із `%PROJECT% = spirit`
> (`C:\claude\spirit`, слаг профілю `C--claude-spirit`). Результат — `.claude/` у
> репо, `SPIRIT.md` як журнал стану, правило локальності в `CLAUDE.md`.
> Нижче — оригінальний, проєктно-незалежний текст процедури: повторюй її за
> потреби (експорт історії — знімок на момент часу, не синхронізація).

**Для кого:** для AI-агента (Claude Code), що працює на цьому ПК і має підготувати
проєкт `C:\claude\%PROJECT%\` до переносу на іншу машину через GitHub.

**Мета:** усе, що стосується проєкту — інструкції, історія напрацювань, агенти, команди,
скіли, налаштування — має лежати **всередині папки проєкту** і їхати з git.
Нічого проєктного не лишається в профілі юзера (`C:\Users\<user>\.claude\`).

**Ключовий принцип:** це **не синхронізація** і **не копіювання туди-сюди**.
Це одноразовий **експорт-знімок** із профілю в репо + зміна робочої звички:
далі писати одразу в файли репо.

---

## 0. Підготовка: визначити змінні

Замінити `%PROJECT%` на реальну назву папки проєкту (напр. `PROJECT-1`, `PROJECT-2`, `PROJECT-3`).

```powershell
$Project  = '%PROJECT%'                       # ← ЗМІНИТИ
$Root     = "C:\claude\$Project"
$Slug     = "C--claude-$Project"            # як Claude Code іменує теку профілю
$Home_    = "$env:USERPROFILE\.claude"
$SrcProj  = "$Home_\projects\$Slug"         # історія сесій цього проєкту
Write-Host "Проєкт: $Root"
Write-Host "Профіль: $SrcProj"
Test-Path $Root, $SrcProj
```

**Правило слага:** повний шлях проєкту, де `\` і `:` замінені на `-`.
`C:\claude\%PROJECT%` → `C--claude-%PROJECT%`. Якщо `Test-Path $SrcProj` дає `False` —
історії для цього проєкту нема, крок 2 пропускається (це нормально).

---

## 1. Створити структуру в репо

```powershell
New-Item -ItemType Directory -Force -Path `
  "$Root\.claude\agents", "$Root\.claude\commands", "$Root\.claude\skills", "$Root\docs" | Out-Null

foreach ($d in 'agents','commands','skills') {
  $k = "$Root\.claude\$d\.gitkeep"
  if (-not (Test-Path $k)) { New-Item -ItemType File -Path $k | Out-Null }
}
```

> `.gitkeep` обов'язковий — git не зберігає порожні теки.

Цільова структура:

```
C:\claude\%PROJECT%\
├─ CLAUDE.md                  ← інструкції проєкту (правило локальності + мапа .claude/)
├─ %PROJECT%.md               ← журнал стану / джерело правди
├─ NOTES.md                   ← вільні нотатки (опційно)
├─ .gitignore                 ← + .claude/settings.local.json
├─ docs\                      ← ця інструкція та інша документація
└─ .claude\
   ├─ README.md               ← пояснення структури
   ├─ settings.json           ← спільні налаштування (комітиться)
   ├─ agents\.gitkeep         ← сюди: .claude\agents\<name>.md
   ├─ commands\.gitkeep       ← сюди: .claude\commands\<name>.md
   └─ skills\.gitkeep         ← сюди: .claude\skills\<name>\SKILL.md
```

Мапа «звідки → куди» (проєктне має пріоритет над однойменним глобальним):

| Що | Глобально (НЕ їде з git) | Проєктно (їде з git) |
|---|---|---|
| Агенти | `~\.claude\agents\*.md` | `C:\claude\%PROJECT%\.claude\agents\*.md` |
| Команди | `~\.claude\commands\*.md` | `C:\claude\%PROJECT%\.claude\commands\*.md` |
| Скіли | `~\.claude\skills\<name>\SKILL.md` | `C:\claude\%PROJECT%\.claude\skills\<name>\SKILL.md` |
| Налаштування | `~\.claude\settings.json` | `C:\claude\%PROJECT%\.claude\settings.json` |
| Пам'ять/історія | `~\.claude\projects\<slug>\` | `%PROJECT%.md` / `NOTES.md` (текстом, не jsonl) |

---

## 2. Експорт історії сесій

Історія лежить як `.jsonl`-транскрипти:

```powershell
Get-ChildItem "$SrcProj\*.jsonl" | Select-Object Name, Length, LastWriteTime
```

### 2.1. ⚠️ Спочатку прочитати, лише потім переносити

**Не копіювати `.jsonl` у репо наосліп.** Причини:

1. **Секрети.** Транскрипти містять сирий вивід усіх команд: токени, ключі, паролі,
   вміст `.env`, внутрішні IP. Потрапивши в git — це назавжди в історії репо.
2. **Обсяг і шум.** Це машинний формат із службовими полями; для людини й для
   майбутнього агента він майже нечитабельний.
3. **Цінність не в транскрипті, а у висновках.** Потрібні рішення, домовленості,
   граблі — а не дослівний лог.

### 2.2. Правильний спосіб: витягти зміст і записати прозою

Прочитати транскрипти й **переписати змістовну частину** в `%PROJECT%.md`:

```powershell
# Витягти лише повідомлення користувача — швидкий огляд, про що були сесії
Get-ChildItem "$SrcProj\*.jsonl" | ForEach-Object {
  Get-Content $_ -Encoding UTF8 | ForEach-Object {
    try { $o = $_ | ConvertFrom-Json } catch { return }
    if ($o.type -eq 'user' -and $o.message.content -is [string]) {
      "U: " + $o.message.content
    }
  }
} | Select-Object -First 200
```

Далі агент **сам читає** цей вивід і формулює в `%PROJECT%.md`:
- ухвалені архітектурні рішення і **чому** саме так;
- домовленості й обмеження, не виведені з коду;
- інциденти й граблі (щоб не наступити вдруге);
- поточний стан і що лишилось.

**Не переносити:** те, що вже видно з коду, `git log` або самого `CLAUDE.md`.
Дублювання = гарантований розсинхрон.

### 2.3. Якщо сирий архів усе ж потрібен

Тільки після ручного вичитування на секрети, і краще **поза git**:

```powershell
# у .gitignore, не комітиться — просто локальна копія поруч із проєктом
New-Item -ItemType Directory -Force -Path "$Root\.history-archive" | Out-Null
Copy-Item "$SrcProj\*.jsonl" "$Root\.history-archive\"
```

---

## 3. Перенести агентів / команди / скіли

Скопіювати з профілю **лише те, що стосується цього проєкту** (не все підряд):

```powershell
# Подивитись, що взагалі є глобального
Get-ChildItem "$Home_\agents\*.md", "$Home_\commands\*.md" -ErrorAction SilentlyContinue | Select-Object FullName
Get-ChildItem "$Home_\skills" -Directory -ErrorAction SilentlyContinue | Select-Object Name
```

Далі копіювати **точково**, переглянувши вміст кожного файлу:

```powershell
Copy-Item "$Home_\agents\<name>.md"   "$Root\.claude\agents\"
Copy-Item "$Home_\commands\<name>.md" "$Root\.claude\commands\"
Copy-Item "$Home_\skills\<name>" "$Root\.claude\skills\" -Recurse
```

**Уточнення:**
- Глобальні агенти залишити на місці — вони можуть використовуватись іншими проєктами.
  Копіюємо, не переміщуємо.
- Після копіювання перевірити, чи в них нема абсолютних шляхів під цю машину
  (`C:\Users\<user>\...`) — на іншій машині вони зламаються. Замінити на відносні від кореня репо.

---

## 4. Налаштування: розділити спільне й локальне

```powershell
$s = "$Root\.claude\settings.json"
if (-not (Test-Path $s)) {
  '{ "$schema": "https://json.schemastore.org/claude-code-settings.json" }' |
    Set-Content $s -Encoding UTF8
}
```

| Файл | Що туди | В git? |
|---|---|---|
| `.claude\settings.json` | permissions, hooks, спільні env — однакове на всіх машинах | так |
| `.claude\settings.local.json` | ключі, токени, локальні абсолютні шляхи | **ні** |

`settings.local.json` **перекриває** `settings.json` при збігу ключів.

**⚠️ Не копіювати `~\.claude\settings.json` у репо цілком** — там майже напевно є
машинні шляхи й дозволи, зав'язані на цей ПК. Перенести вибірково те, що справді спільне.

---

## 5. Написати CLAUDE.md

У корені проєкту. Мінімум, що має бути:

- **Правило локальності роботи.** Уся робота, документація і «пам'ять» — всередині
  репо, не в профілі. Вбудований memory-інструмент не використовувати (він пише в
  профіль юзера і через git не їде): факти писати тільки в `%PROJECT%.md` або `NOTES.md`.
  Переїзд на іншу машину = `git clone` (+ `git lfs pull`, якщо є LFS).
- **Джерело правди.** `%PROJECT%.md` — журнал стану: читати перед змінами,
  оновлювати після кожної значущої зміни, тестового прогону чи інциденту.
- **Конфігурація Claude Code.** `.claude/agents/`, `.claude/commands/`,
  `.claude/skills/`, `.claude/settings.json` — усе в репо; проєктне має пріоритет
  над глобальним.

---

## 6. Перевірка перед комітом

```powershell
git status --short
git diff --cached --stat
```

**Обов'язковий чекліст:**

- [ ] У staged-файлах **нема секретів** — перечитати очима, не покладатись на пам'ять.
- [ ] `.claude/settings.local.json` у `.gitignore` і **не** в staged.
- [ ] `.jsonl`-транскрипти **не** потрапили в git (або свідомо вичитані).
- [ ] У `.claude/**` нема абсолютних шляхів під цю машину.
- [ ] `.gitkeep` є в кожній порожній теці.
- [ ] `CLAUDE.md` і `%PROJECT%.md` існують і не суперечать одне одному.

```powershell
git add CLAUDE.md .claude/ .gitignore docs/ "$Project.md"
git commit -m "chore: keep Claude Code config and project state in-repo"
```

**Пуш — тільки з явного дозволу людини.** Не пушити автоматично.
(Перевірити наявність auto-push hook у цільовому проєкті: `Get-ChildItem $Root\.git\hooks`.)

---

## 7. Перевірка міграції

На цій машині:

```powershell
# Клонувати в тимчасову теку і переконатись, що все на місці
git clone $Root "$env:TEMP\migration-check-$Project"
Get-ChildItem "$env:TEMP\migration-check-$Project" -Recurse -Force `
  -Include 'CLAUDE.md','settings.json','*.gitkeep' | Select-Object FullName
Remove-Item "$env:TEMP\migration-check-$Project" -Recurse -Force
```

Якщо у клоні є `CLAUDE.md`, `.claude/` з підтеками і `%PROJECT%.md` — міграція вдалась.

---

## Додаткові уточнення та обмеження

### Що НЕ переноситься і не може бути перенесене
- **Нові транскрипти сесій.** Claude Code завжди пише їх у `~\.claude\projects\<slug>\`.
  Цей шлях перепризначити не можна. Тому експорт із кроку 2 — **знімок на момент часу**,
  а не постійна синхронізація. Повторювати за потреби.
- **Глобальний `~\.claude\CLAUDE.md`.** Він у профілі й на нову машину не поїде.
  Якщо в ньому є правила, критичні для проєкту — продублювати їх у проєктний `CLAUDE.md`.
- **`~\.claude\history.jsonl`, `plans\`, `tasks\`, `sessions\`** — теж профільні.
  За потреби витягти зміст текстом, як у кроці 2.

### Чому саме так, а не автосинк профілю в репо
Синхронізація профілю (symlink, junction, скрипт-копіювальник) виглядає зручніше,
але дає три проблеми: профіль спільний для всіх проєктів (потягне чуже), транскрипти
ростуть і містять секрети, а symlink на іншій машині доведеться відтворювати руками —
тобто саме те, чого міграція мала позбутися. Одноразовий експорт + звичка писати
в репо дає той самий результат без цих ризиків.

### Профіль юзера спільний між акаунтами Claude
`~\.claude\` прив'язаний до **Windows-профілю**, а не до Claude-акаунта. Будь-яка сесія
під цим користувачем бачить ті самі глобальні інструкції й транскрипти всіх проєктів.
Це ще один аргумент тримати проєктне в репо: у профілі воно змішане з чужим.

### Git LFS
Якщо в проєкті є бінарники через LFS — на новій машині після `git clone` обов'язково:

```bash
git lfs install
git lfs pull
```

Без цього замість бінарників будуть текстові файли-вказівники, і скрипти зламаються
з неочевидною помилкою.

### CRLF на Windows
Git попереджає `LF will be replaced by CRLF` — це нормально й на роботу не впливає.
Якщо заважає, додати в `.gitattributes`: `* text=auto`.

### Порядок дій має значення
Спочатку `.gitignore` (крок 4), **потім** копіювання/експорт (кроки 2–3).
Інакше є ризик, що `settings.local.json` чи транскрипт потрапить у staged раніше,
ніж почне діяти ігнор — а видаляти з історії git значно складніше, ніж не додавати.
