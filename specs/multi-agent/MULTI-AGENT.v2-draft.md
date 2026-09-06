# MULTI-AGENT.md — Universal Git Coordination Protocol

> Версія: `2.0-draft`
>
> Призначення: один нормативний документ для всіх coding-agent у репозиторії.
> Той самий файл використовується **Master** і **Slave**. Відмінність ролей задається
> лише правами та поточною роллю агента, а не різними інструкціями.

---

## 0. Нормативна модель

Цей документ є операційним протоколом, а не описом рекомендацій.

Ключові принципи:

1. `git` — джерело істини для фактичного стану коду.
2. План робіт — окреме джерело істини для стану задач.
3. `main` — інтеграційна гілка, а не канал координації.
4. Кожна задача має одного активного власника.
5. Claim має бути конкурентно-безпечним: перемогу визначає серверний `git push`, а не локальний час.
6. Невідомий стан = **небезпечно продовжувати**. Агент зупиняється і відновлює консистентність.
7. Код не вважається завершеним без тестів, перевірки diff та незалежного review.
8. Deployment — окремий privileged action і ніколи не є побічним ефектом merge.
9. Секрети, runtime state і production artifacts не входять до git.
10. Будь-яка дія має бути повторюваною або безпечно перериваною.

---

# 1. Ролі

## 1.1 Master

Master — агент, який має право керувати інтеграцією та архітектурними рішеннями.

Типові права:

- приймати та уточнювати task definition;
- змінювати architectural/spec documents;
- інтегрувати завершені task branches;
- закривати review;
- керувати release/deployment;
- виконувати privileged operations лише після явного дозволу власника;
- розблоковувати аварійні стани.

Master **не отримує права ігнорувати gates**.

## 1.2 Slave

Slave — агент-виконавець.

Типові права:

- взяти доступну задачу;
- створити isolated worktree/branch;
- реалізувати код;
- додати/змінити тести;
- виконати локальні checks;
- створити review artifact;
- передати task у `REVIEW`.

Slave не повинен:

- force-push;
- напряму переписувати `main`;
- merge чужу branch;
- deploy у production;
- змінювати чужий active claim;
- обходити hooks або CI.

## 1.3 Важливо

**Master і Slave працюють за цим самим документом.**

Role-specific restrictions визначаються тільки секцією `ROLE`.

```text
ROLE=master
ROLE=slave
```

Якщо роль не визначена явно — агент працює як `slave`.

---

# 2. Початок кожної сесії

Перед будь-якою зміною repository:

```bash
git fetch --all --prune
git status --short --branch
git branch --show-current
git log -1 --oneline
```

Потім синхронізувати базову гілку:

```bash
git switch main
git pull --ff-only
```

Якщо `git pull --ff-only` не проходить:

**STOP.**

Не робити автоматичний merge.

Причину треба визначити окремо:

```bash
git status
git log --oneline --decorate --graph -20
git branch -vv
```

---

# 3. Ідентичність агента

Кожен агент має стабільний `AGENT_ID` на час активної роботи.

Приклад:

```text
AGENT_ID=claude-a17f
ROLE=slave
```

Якщо owner не надав ID, генерується:

```text
claude-<4 hex>
```

ID не змінюється всередині сесії.

Рекомендовано фіксувати:

```bash
export AGENT_ID="claude-a17f"
export ROLE="slave"
```

Не використовувати email, токени, API keys або інші credentials як agent ID.

---

# 4. Джерела істини

У системі використовуються чотири рівні truth:

### T0 — Git object database

Фактичний код, commits, branches, tags.

У разі суперечності:

```text
git history > task metadata
```

### T1 — Task registry

Рекомендований файл:

```text
BACKLOG.md
```

Він описує intent/state задач, але не замінює git history.

### T2 — Specification

Наприклад:

```text
specs/pro-port/
```

Spec визначає контракт системи.

### T3 — Runtime/deployment state

Production/server state не вважається доведеним лише тому, що git branch містить код.

Deployment status має підтверджуватися runtime check.

---

# 5. Структура task

Кожна задача повинна мати стабільний ID:

```text
S3-accounts
API-142
SEC-021
DEPLOY-009
```

Мінімальна модель:

| Field | Значення |
|---|---|
| ID | стабільний task ID |
| State | TODO / CLAIMED / ACTIVE / REVIEW / DONE / BLOCKED / ABANDONED |
| Owner | AGENT_ID |
| Base | commit SHA |
| Branch | task branch |
| Depends-on | task IDs |
| Claimed UTC | timestamp |
| Updated UTC | timestamp |
| Commits | SHA/range |
| Review | artifact |
| Notes | короткий handoff |

---

# 6. Task lifecycle

Єдиний допустимий flow:

```text
TODO
  ↓
CLAIMED
  ↓
ACTIVE
  ↓
REVIEW
  ↓
DONE
```

Альтернативні переходи:

```text
CLAIMED → TODO
ACTIVE  → BLOCKED
REVIEW  → ACTIVE
ACTIVE  → ABANDONED
BLOCKED → ACTIVE
```

Неприпустимі стрибки:

```text
TODO → DONE
TODO → REVIEW
CLAIMED(other) → ACTIVE
```

---

# 7. Dependency gate

Агент може взяти задачу лише якщо:

```text
State == TODO
AND
all Depends-on == DONE
```

Перевіряти фактичний стан залежностей через git, а не лише за текстом backlog.

Наприклад:

```bash
git log --all --grep="Task: API-141"
```

Якщо metadata каже `DONE`, але код не знаходиться:

```text
BLOCKED / repair state
```

Не продовжувати реалізацію поверх невідомого базису.

---

# 8. Конкурентний claim

## 8.1 Заборонена модель

Не вважати локальне редагування `BACKLOG.md` lock-механізмом.

Погана схема:

```text
read TODO
edit CLAIMED
git commit
git push
```

без перевірки актуального remote state.

## 8.2 Нормальна схема

Перед claim:

```bash
git fetch origin --prune
git switch main
git pull --ff-only
```

Потім ще раз перевірити task.

Claim commit повинен бути:

- маленьким;
- атомарним;
- без змін коду;
- єдиним commit у цій операції.

Приклад:

```bash
git add BACKLOG.md
git commit -m "chore(backlog): claim API-142

Task: API-142
Owner: claude-a17f"
git push origin main
```

Якщо push rejected:

```bash
git pull --rebase origin main
```

Після rebase **обов'язково перечитати task**.

Якщо owner уже інший:

```text
claim програно → task залишити → вибрати іншу
```

Ніколи не force-push для "повернення" claim.

---

# 9. Сильніша модель для protected main

Якщо `main` захищений, direct push не використовується.

Рекомендована модель:

```text
agent branch
   ↓
Pull Request
   ↓
CI
   ↓
review
   ↓
merge queue
   ↓
main
```

Для protected repositories повинні бути увімкнені як мінімум:

- Pull Request requirement;
- required status checks;
- required review;
- stale review invalidation;
- no force-push;
- no direct push для агентів.

Для критичних paths:

```text
CODEOWNERS + required code-owner review
```

Залежно від платформи дозволено використовувати merge queue.

**BACKLOG не повинен обходити branch protection.**

---

# 10. Рекомендована ізоляція: git worktree

Кожна активна task повинна мати окремий worktree або окремий clone.

Перевага `git worktree`:

```bash
git worktree add -b task/API-142 ../wt-API-142 main
```

Перевірка:

```bash
git worktree list
```

Це запобігає одночасному переключенню branch у спільному filesystem workspace.

Не працювати двом агентам в одному worktree.

---

# 11. Naming convention

Branch:

```text
task/<task-id>
```

Приклади:

```text
task/API-142
task/SEC-021
task/DEPLOY-009
```

Для hotfix:

```text
hotfix/<id>
```

Для release:

```text
release/<version>
```

Для tooling:

```text
chore/<id>
```

---

# 12. Робочий цикл задачі

Після успішного claim:

```bash
git switch -c task/<TASK_ID>
```

або:

```bash
git worktree add -b task/<TASK_ID> ../wt-<TASK_ID> main
```

Потім:

```text
1. Understand
2. Inspect
3. Test
4. Implement
5. Verify
6. Review
7. Handoff
```

---

# 13. Gate 0 — Understand

Перед редагуванням:

- прочитати task;
- прочитати пов'язані spec;
- перевірити dependencies;
- знайти існуючий implementation;
- визначити acceptance criteria;
- перевірити security/deployment impact.

Не починати coding лише за назвою task.

---

# 14. Gate 1 — Inspect

Обов'язково перевірити:

```bash
git status
git diff
git log --oneline -20
```

Для target files:

```bash
git log --follow -- <file>
```

Перед зміною API/config/security code потрібно шукати всі call sites.

---

# 15. Gate 2 — Test first

Для bug/behavioral change:

```text
RED → implementation → GREEN
```

Спочатку створити failing test або інший deterministic reproduction.

Запустити:

```bash
TEST_COMMAND
```

і зафіксувати:

```text
Expected RED
Actual RED
```

Для документаційних або purely mechanical tasks цей gate може бути замінений на deterministic validation.

---

# 16. Gate 3 — Implementation

Implementation має бути:

- мінімальним;
- локальним;
- backward-compatible, якщо spec не вимагає breaking change;
- без unrelated refactor;
- без зміни секретів;
- без runtime credentials;
- без зміни deployment state.

Не виправляти "заодно" сторонні проблеми.

Для сторонньої проблеми створити окремий task.

---

# 17. Gate 4 — GREEN + verification

Перед review:

```bash
git diff --check
```

Потім повний relevant test suite.

Мінімум:

```text
unit tests
integration tests, якщо affected
lint/static analysis, якщо доступний
build, якщо affected
security checks, якщо affected
```

Не писати:

```text
"tests should pass"
```

Потрібен фактичний результат.

---

# 18. Gate 5 — Independent review

Кожна нетривіальна task повинна пройти незалежний review.

Review бажано виконувати:

1. іншим агентом;
2. в іншій session/context;
3. іншим model tier;
4. або окремим deterministic review tool.

Self-review того самого context недостатній для critical changes.

Reviewer перевіряє:

```text
Correctness
Security
Concurrency
Failure modes
Backward compatibility
Data integrity
Tests
Operational impact
```

Review artifact:

```text
specs/reviews/<TASK_ID>.md
```

---

# 19. Review loop

Допустимий цикл:

```text
implementation
   ↓
review
   ↓
fix
   ↓
review
   ↓
fix
```

Рекомендований hard cap:

```text
3 iterations
```

Якщо після 3 незалежних проходів проблеми не зникають:

```text
BLOCKED
```

Створюється:

```text
specs/<spec>.halt.md
```

У halt artifact:

- проблема;
- що перевірено;
- що не вирішено;
- ризик;
- рекомендований наступний крок.

Не можна нескінченно мутувати код лише для досягнення формального "LGTM".

---

# 20. Commit protocol

Commit message:

```text
<type>(<scope>): <summary>
```

Types:

```text
feat
fix
test
refactor
docs
chore
perf
security
```

Обов'язковий trailer:

```text
Task: <TASK_ID>
```

Приклад:

```text
fix(auth): rotate session after login

Task: SEC-021
```

Commit має бути atomic.

Не змішувати:

```text
feature + unrelated cleanup + formatting + deployment
```

в один commit.

---

# 21. Push protocol

Перед push:

```bash
git fetch origin
git rebase origin/main
```

Потім:

```bash
git status
git diff origin/main...HEAD
```

Після цього:

```bash
git push -u origin task/<TASK_ID>
```

Для вже опублікованої task branch:

```text
force-push заборонений за замовчуванням.
```

`--force-with-lease` допускається лише якщо:

- task owner — поточний агент;
- branch належить цьому агенту;
- причина зафіксована;
- remote branch не містить чужих commits.

---

# 22. Handoff

Перед передачею задачі:

```text
State: REVIEW
Owner: <AGENT_ID>
Branch: task/<TASK_ID>
Base: <SHA>
Commits: <SHA/range>
Tests: PASS
Review: <artifact>
Risk: <LOW|MEDIUM|HIGH>
Notes: <short>
```

Handoff повинен дозволяти іншому агенту продовжити роботу без повторного reverse engineering.

---

# 23. Merge policy

## Master

Master може merge тільки коли:

```text
task state == REVIEW
tests == PASS
review == PASS
working tree == clean
branch == rebased/current
no unresolved conflict
```

Для protected main:

```text
PR + required checks + required review + merge queue
```

Для plain Git:

```text
git merge --ff-only task/<TASK_ID>
```

або інша політика, явно визначена repository.

## Slave

Slave:

```text
push branch
set REVIEW
handoff
STOP
```

Slave не merge.

---

# 24. Conflict protocol

При conflict:

```text
STOP
```

Не вирішувати conflict "наосліп".

Спочатку:

```bash
git fetch origin
git log --graph --oneline --decorate --all -30
git diff
```

Визначити:

```text
Which branch changed?
Which intent wins?
Is the conflict semantic or textual?
```

Після ручного resolution:

```bash
tests
git diff --check
independent review
```

Якщо semantic intent неочевидний:

```text
BLOCKED
```

Master приймає architectural decision.

---

# 25. Stale claim

Claim не вважається stale лише за віком.

Рекомендована модель:

```text
heartbeat = recent branch activity
```

Перевіряти:

```bash
git log --all --grep="Task: <TASK_ID>" --since="<window>"
git branch -a
```

Claim можна reclaim, якщо одночасно:

```text
age > configured TTL
AND
no recent commit
AND
no recent branch activity
AND
no explicit block/handoff
```

Default TTL:

```text
24h
```

але для довгих задач допускається task-specific TTL.

Reclaim документується:

```text
RECLAIM <UTC> by <AGENT_ID>: stale, no activity
```

---

# 26. Unknown-state rule

Будь-яка з цих ситуацій означає STOP:

- невідомо, хто володіє task;
- branch змінилася зовнішнім агентом;
- backlog суперечить git;
- tests неможливо виконати;
- deployment state невідомий;
- secrets могли потрапити в diff;
- conflict має невизначену семантику;
- spec суперечить implementation;
- dependency state невідомий.

Заборонено "припустити, що все нормально".

---

# 27. BACKLOG consistency

Якщо:

```text
BACKLOG = TODO
git = task implemented
```

перевірити history:

```bash
git log --all --grep="Task: <TASK_ID>"
```

Якщо implementation реально merged:

```text
BACKLOG → DONE
```

Якщо:

```text
BACKLOG = DONE
git = code absent
```

то:

```text
BACKLOG → TODO
```

з приміткою про inconsistency.

**Git history має більшу вагу, ніж metadata.**

---

# 28. Spec ownership

Specification files повинні мати owner.

Рекомендовано:

```text
specs/
  architecture/
  product/
  security/
  deployment/
  reviews/
```

Master:

- змінює section list;
- приймає architecture decisions;
- закриває review.

Slave не змінює architecture contract без task, що прямо це дозволяє.

---

# 29. Security gate

Перед кожним merge:

```text
No secrets
No credential files
No production env
No debug leakage
No disabled security control
```

Особливо перевіряти:

```bash
git diff --cached
git diff origin/main...HEAD
git status --ignored
```

Для PHP production:

```text
display_errors = Off
error_reporting = E_ALL
session.use_only_cookies = On
session.cookie_httponly = On
session.cookie_secure = On
session.cookie_samesite = Lax
```

Secrets повинні існувати лише в runtime configuration.

---

# 30. Deployment boundary

Deployment є окремою привілейованою операцією.

Правило:

```text
merge != deploy
```

Заборонено автоматично трактувати:

```text
DONE
```

як:

```text
DEPLOYED
```

Production deployment потребує:

```text
explicit authorization
+
known commit SHA
+
clean build
+
deployment dry-run
+
runtime health check
```

Для production:

```text
build
→ dry-run
→ deploy
→ health
→ security smoke tests
→ record result
```

---

# 31. Deployment sanity checks

Перед FTP/remote deployment перевірити, що remote path є логічним path відносно FTP account root.

Не змішувати:

```text
filesystem absolute path
```

і:

```text
FTP account-relative path
```

Наприклад, якщо FTP root вже є docroot:

```text
FTP_PATH=/
```

а не:

```text
FTP_PATH=/home/telezip/telezip.net/pro/
```

Це має бути підтверджено actual remote layout, а не назвою директорії.

---

# 32. Production smoke test

Після deployment перевірити:

```text
health endpoint
API routing
security boundaries
static assets
authentication
critical business path
```

Мінімальний health endpoint повинен бути дешевим і deterministic.

Для pro.telezip.net очікується:

```text
/api/health → HTTP 200
```

і неіснуючий API:

```text
/api/does-not-exist → HTTP 404 JSON
```

Перевірити, що internal files не public:

```text
/.env
/app/Bootstrap.php
/vendor/autoload.php
```

Expected:

```text
403
```

---

# 33. Runtime configuration rule

Не комітити:

```text
deploy.env
site/.env
runtime state
site/storage/
credentials
private keys
tokens
```

Production `.env` створюється на сервері.

Repository містить лише:

```text
.env.example
```

без секретних значень.

---

# 34. Rollback

Кожен production deployment повинен бути rollbackable.

Перед deployment зберегти:

```text
previous known-good commit
current commit
deployment timestamp
```

Rollback target:

```text
known-good SHA
```

Не використовувати:

```text
"останній commit який здається правильним"
```

Rollback — це окрема, явно записана операція.

---

# 35. Idempotency

Команди automation повинні бути максимально idempotent.

Повторний запуск:

```text
не повинен пошкодити state
не повинен дублювати resources
не повинен видалити чужий state
```

Перед destructive action:

```text
validate → plan → explicit execute
```

---

# 36. Hooks and CI are gates

Заборонено:

```bash
git commit --no-verify
git push --force origin main
```

без emergency procedure, що явно дозволена repository policy.

Pre-commit, CI та deployment checks не є "перешкодами".

Це частина протоколу якості.

---

# 37. Emergency procedure

Emergency допускається лише для:

```text
production outage
security incident
data corruption
blocked integration
```

Порядок:

```text
1. Freeze normal work
2. Identify incident
3. Record incident ID
4. Create hotfix branch
5. Minimize change
6. Test
7. Independent review, якщо стан дозволяє
8. Deploy with explicit authorization
9. Verify runtime
10. Write postmortem
```

Emergency не дозволяє приховувати commits або переписувати історію без документованої причини.

---

# 38. Agent communication

Не покладатися на chat memory.

Усе, що потрібно наступному агенту:

```text
task state
decision
risk
tests
review
handoff
```

має бути в repository artifacts.

Chat може бути transient.

Git state — persistent.

---

# 39. Review artifact format

`specs/reviews/<TASK_ID>.md`

Рекомендований формат:

```md
# Review: <TASK_ID>

## Scope
<what was reviewed>

## Base
<base SHA>

## Head
<head SHA>

## Checks
- [ ] Tests
- [ ] Static analysis
- [ ] Security
- [ ] Compatibility
- [ ] Operational impact

## Findings

### Critical
...

### High
...

### Medium
...

### Low
...

## Decision

PASS | PASS_WITH_NOTES | FAIL

## Reviewer
<AGENT_ID>

## Iteration
1
```

---

# 40. Definition of Done

Task може перейти в `DONE` лише коли:

```text
[ ] requirements satisfied
[ ] dependency state valid
[ ] tests PASS
[ ] implementation complete
[ ] diff reviewed
[ ] security checked
[ ] review artifact exists
[ ] branch pushed
[ ] merge completed by authorized agent
[ ] final SHA recorded
```

Для deployment task додатково:

```text
[ ] build PASS
[ ] dry-run PASS
[ ] deployment authorized
[ ] runtime health PASS
[ ] security smoke PASS
[ ] rollback target recorded
```

---

# 41. Agent startup checklist

```text
[ ] Determine AGENT_ID
[ ] Determine ROLE
[ ] Fetch origin
[ ] Verify clean/known workspace
[ ] Update main
[ ] Read BACKLOG
[ ] Check dependencies
[ ] Check existing claims
[ ] Select task
[ ] Claim atomically
[ ] Create isolated branch/worktree
[ ] Start Gate 0
```

---

# 42. Agent stop checklist

Before ending a session:

```text
[ ] No uncommitted unknown changes
[ ] Task state is accurate
[ ] Branch is pushed
[ ] Tests/results recorded
[ ] Review artifact exists if applicable
[ ] Handoff notes written
[ ] No secrets staged
[ ] No orphaned worktree if task is finished
```

---

# 43. Anti-patterns

## Shared mutable workspace

```text
agent A + agent B → same working directory
```

Forbidden.

## Chat-only coordination

```text
"I told the other agent I'm working on it."
```

Not a claim.

## Local claim

```text
"I edited BACKLOG locally."
```

Not a claim.

## Green-by-assumption

```text
"Tests should pass."
```

Not verification.

## Self-approval

```text
"I reviewed my own patch."
```

Not independent review.

## Merge-by-authority

```text
"I am Master, therefore tests are optional."
```

Forbidden.

## Deploy-after-merge assumption

```text
"main changed, therefore production changed."
```

False.

---

# 44. Minimal state machine

```text
                    ┌──────────────┐
                    │     TODO     │
                    └──────┬───────┘
                           │ claim
                           ▼
                    ┌──────────────┐
                    │   CLAIMED    │
                    └──────┬───────┘
                           │ start
                           ▼
                    ┌──────────────┐
                    │    ACTIVE    │◄─────────┐
                    └──────┬───────┘          │
                           │ review           │ fix
                           ▼                  │
                    ┌──────────────┐          │
                    │    REVIEW    │──────────┘
                    └──────┬───────┘
                           │ pass
                           ▼
                    ┌──────────────┐
                    │     DONE     │
                    └──────────────┘

ACTIVE ───────────► BLOCKED
CLAIMED ──────────► TODO  (only by stale-claim rule)
```

---

# 45. Repository-level configuration

Рекомендовано мати:

```text
MULTI-AGENT.md
BACKLOG.md
CODEOWNERS
CONTRIBUTING.md
```

та:

```text
specs/
  reviews/
```

Для CI:

```text
.github/workflows/
```

якщо використовується GitHub.

---

# 46. Recommended protected-main policy

Для production repositories:

```text
main:
  require_pull_request: true
  require_status_checks: true
  require_review: true
  dismiss_stale_reviews: true
  require_code_owner_review: true   # critical paths
  allow_force_push: false
  allow_branch_delete: false
```

За можливості:

```text
merge_queue: enabled
linear_history: enabled
```

---

# 47. Compatibility with plain Git

Якщо немає GitHub/GitLab/Bitbucket automation:

```text
BACKLOG + atomic push + task branches + review artifacts
```

є fallback mode.

Але навіть у plain Git:

```text
main
```

має бути інтеграційною гілкою.

Не використовувати `main` як shared mutable branch для implementation.

---

# 48. Compatibility with agent frameworks

Протокол не залежить від:

```text
Claude
GPT
Codex
Cursor
Copilot
custom agent
human
```

Agent framework може додатково мати:

```text
subagents
tool calls
hooks
MCP/plugins
review agents
```

але repository protocol має залишатися валідним без них.

---

# 49. Final authority hierarchy

У разі конфлікту:

```text
1. Explicit current-session owner authorization
2. Repository protection / CI
3. Git history
4. Approved specification
5. Task metadata
6. Agent assumptions
```

Але security policy не може бути обійдена task metadata.

---

# 50. Operational rule

> **Не роби дію, результат якої наступний агент не зможе відновити з repository state.**

Кожна істотна дія повинна залишати:

```text
commit
artifact
task state
or runtime evidence
```

---

# 51. Protocol objective

Мета цього документа — не максимізувати кількість агентів.

Мета:

```text
parallelism
+
deterministic ownership
+
isolated work
+
testable changes
+
independent review
+
protected integration
+
safe deployment
```

При збільшенні кількості агентів система повинна деградувати контрольовано:

```text
more agents
→ more branches
→ more review queue

але не:

more agents
→ more races
→ more corrupted main
→ more unknown state
```

---

# 52. Project-specific note: pro.telezip.net

Для цього repository deployment має окремі security/runtime assumptions.

Зокрема:

- production `.env` не повинен потрапляти в deploy tree;
- `site/storage/` не повинен переноситися між deploy як source artifact;
- FTPS є обов'язковим transport layer;
- після deployment `/api/health` є базовим smoke-test;
- internal PHP/vendor/env paths мають бути закриті від public access.

Ці правила походять із deployment evidence та мають залишатися прив'язаними до конкретного project deployment contract, а не переноситися автоматично на інші repositories.

---

# 53. Versioning this protocol

Зміни до цього файлу повинні мати власну історію:

```text
docs(multi-agent): <summary>
```

і проходити review.

Breaking changes до protocol:

```text
MAJOR
```

Operational improvements:

```text
MINOR
```

Typo/clarification:

```text
PATCH
```

---

# 54. Golden rule

```text
CLAIM → ISOLATE → TEST → IMPLEMENT → VERIFY → REVIEW → HANDOFF → MERGE → VERIFY
```

Ні один agent не може пропустити крок лише через свою роль.

Master отримує більше **authority**, але не менше **verification**.

Slave отримує менше **authority**, але ті самі **quality gates**.
