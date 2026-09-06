# MULTI-AGENT.md — Універсальний протокол координації та інженерії мультиагентних систем

> **Версія:** 4.0
>
> **Статус:** нормативний документ / production-grade draft
>
> **Мова:** українська; ідентифікатори, команди, параметри, стани та machine-readable поля — англійською
>
> **Область застосування:** один Git-репозиторій, багато автономних або напівавтономних агентів, люди, CI/CD та автоматизовані інструменти
>
> **Основна мета:** безпечна висококонкурентна розробка з детермінованим володінням, ізольованим виконанням, відтворюваною перевіркою, аудитовною інтеграцією, контрольованим deployment та безпечною відмовостійкістю

---

# 0. Призначення та межі гарантій

Цей документ є **протоколом операційної поведінки**, а не лише рекомендаціями стилю розробки.

Протокол визначає:

- як агент отримує право працювати над задачею;
- як доводиться актуальність цього права;
- як ізолюється код і зовнішній стан;
- як запобігати race condition, TOCTOU, split-brain та stale-state;
- як проходять test, verification, review та integration;
- як контролюється privileged deployment;
- як система відновлюється після crash, network outage або пошкодження координаційного стану;
- які інваріанти повинні залишатися істинними незалежно від кількості агентів.

Протокол **НЕ стверджує**, що Git сам по собі є повноцінним distributed lock manager або Byzantine Fault Tolerant consensus system.

Git може бути надійним **durable coordination substrate**, але частина гарантій цього документа вимагає:

- server-side hooks;
- protected branches;
- CI policy;
- trusted coordinator/service;
- ізоляції процесів;
- контейнеризації;
- access control;
- audit logs;
- зовнішніх runtime/deployment controls.

## 0.1. Модель відмов

За замовчуванням система повинна витримувати:

```text
FAIL-STOP
CRASH
RESTART
NETWORK PARTITION
MESSAGE LOSS
DUPLICATE REQUEST
TIMEOUT
STALE STATE
CONCURRENT CLAIM
PARTIAL EXECUTION
PARTIAL DEPLOYMENT
BUGGY AGENT
MISBEHAVING AGENT
```

Протокол також повинен зменшувати наслідки агента, який діє всупереч політиці, **але не можна називати всю систему Byzantine Fault Tolerant**, якщо довіра до Git-сервера, CI, coordinator або security boundary не розглядається окремо.

Тому нормативне формулювання:

```text
FAILURE-TOLERANT AND ADVERSARIAL-RESISTANT
```

а не автоматично:

```text
BYZANTINE FAULT TOLERANT
```

---

# 1. Архітектурна доктрина

Основний принцип:

```text
DISCOVER
  ↓
VALIDATE
  ↓
CLAIM
  ↓
FENCE
  ↓
ISOLATE
  ↓
UNDERSTAND
  ↓
TEST
  ↓
IMPLEMENT
  ↓
VERIFY
  ↓
INDEPENDENT REVIEW
  ↓
APPROVE
  ↓
INTEGRATE
  ↓
VERIFY MAIN
  ↓
AUTHORIZE DEPLOY
  ↓
DEPLOY
  ↓
VERIFY RUNTIME
  ↓
RECORD
```

Критичне правило:

```text
UNKNOWN STATE ≠ SAFE STATE
```

Якщо стан неможливо надійно встановити:

```text
STOP → INSPECT → RECONCILE → CONTINUE
```

---

# 2. Золотий закон протоколу

Наслідкова операція не може виконуватися, якщо хоча б один із цих елементів неможливо довести durable evidence:

```text
AUTHORITY
OWNERSHIP
PRECONDITIONS
TARGET STATE
RESULT
RECOVERY STATE
```

Формально:

```text
CONSEQUENTIAL_OPERATION
    REQUIRES
    DURABLE_EVIDENCE(ownership)
    AND DURABLE_EVIDENCE(preconditions)
    AND DURABLE_EVIDENCE(result_or_failure)
    AND DURABLE_EVIDENCE(recovery_path)
```

`Chat`, пам'ять моделі, усне повідомлення або локальна змінна не є достатнім durable evidence.

Допустимі джерела:

```text
Git ref
Git commit
Task manifest
Review artifact
CI result
Deployment record
Runtime health result
Audit record
```

---

# 3. Основні розділення, які не можна порушувати

Протокол повинен розділяти:

```text
INTENT        ≠ STATE
CLAIM         ≠ IMPLEMENTATION
IMPLEMENTATION ≠ VERIFICATION
VERIFICATION  ≠ REVIEW
REVIEW        ≠ APPROVAL
APPROVAL      ≠ INTEGRATION
INTEGRATION   ≠ DEPLOYMENT
DEPLOYMENT    ≠ HEALTH
HEALTH        ≠ BUSINESS CORRECTNESS
```

Особливо:

```text
MERGED != DEPLOYED != HEALTHY
```

Злиття коду не доводить ані успішного deployment, ані runtime health, ані правильності бізнес-поведінки.

---

# 4. Ролі

Єдиний протокол застосовується до всіх учасників, але існують різні рівні повноважень.

```text
ROLE=master
ROLE=slave
ROLE=human
ROLE=automation
```

Якщо роль не встановлена явно:

```text
ROLE=slave
```

## 4.1. `master`

`master` може:

```text
approve architecture
approve privileged recovery
integrate branches
close reviews
authorize deployment
operate release flow
modify protected protocol files
perform emergency recovery
```

`master` не отримує винятку з quality gates:

```text
authority != test exemption
authority != review exemption
authority != audit exemption
```

## 4.2. `slave`

`slave` може:

```text
claim eligible tasks
create worktrees
implement assigned changes
modify tests
run verification
produce review artifacts
push task branches
request review
handoff work
```

`slave` не може без окремої авторизації:

```text
force-push protected integration branches
merge protected changes
deploy production
rewrite another agent's claim
disable CI/security gates
change protected architecture policy
modify unrelated ownership metadata
```

## 4.3. Мінімально необхідні повноваження

Кожна операція повинна працювати за принципом:

```text
LEAST PRIVILEGE
```

Надання агенту write access до repository не означає надання права:

```text
push main
change branch protection
rotate credentials
deploy production
change CI policy
```

---

# 5. Ієрархія авторитету

У разі суперечності джерел застосовується:

```text
1. explicit current-session authorization
2. repository protection and CI policy
3. trusted coordination service / authoritative refs
4. Git history
5. approved specifications
6. task manifests
7. local state
8. agent assumptions
```

Security policy має пріоритет над task convenience.

Жоден task manifest не може авторизувати заборонену політикою операцію.

---

# 6. Модель істини

Система має щонайменше чотири різні види truth.

## 6.1. Git truth

Відображає:

```text
commits
trees
branches
refs
tags
```

## 6.2. Task truth

Описує:

```text
intent
acceptance criteria
dependencies
risk
ownership constraints
required checks
```

Рекомендовано:

```text
.backlog/
  tasks/
  reviews/
  decisions/
  leases/
  archive/
```

## 6.3. Specification truth

Описує:

```text
architecture
security contracts
product contracts
deployment contract
operational invariants
```

Рекомендовано:

```text
specs/
  architecture/
  security/
  product/
  deployment/
```

## 6.4. Runtime truth

Доводиться лише реальною перевіркою:

```text
health
logs
metrics
smoke tests
service responses
runtime invariants
```

---

# 7. Task manifest

Кожна задача повинна мати машинно-читабельний manifest.

Рекомендований шлях:

```text
.backlog/tasks/<TASK_ID>.yaml
```

Шаблон:

```yaml
id: TASK-001
title: "Neutral task description"
state: TODO

depends_on: []

risk: MEDIUM

paths:
  - foo/**
  - bar/**

exclusive_paths: []

capabilities_required:
  - CODE
  - TEST

database:
  schema_change: false

deployment:
  required: false

acceptance:
  - "observable requirement"

required_checks:
  - unit
  - integration
  - static

review:
  required: true
  minimum_independent_reviewers: 1

lease:
  duration_hours: 24
  heartbeat_minutes: 30
  grace_minutes: 60

sandbox:
  required: true

generated_outputs: false
```

## 7.1. Незмінність контракту

Після початку виконання acceptance criteria не можна тихо змінювати.

Матеріальна зміна вимог:

```text
OLD TASK → BLOCKED/CANCELLED
NEW TASK or VERSIONED REVISION → NEW CONTRACT
```

Це захищає review від зміни цілі після старту роботи.

---

# 8. Стани задачі

Канонічна state machine:

```text
TODO
CLAIMED
ACTIVE
BLOCKED
REVIEW
APPROVED
MERGE_QUEUED
INTEGRATED
DEPLOY_QUEUED
DEPLOYED
DONE
ABANDONED
CANCELLED
RECLAIM_REQUIRED
REBASE_REQUIRED
STUCK
```

Основний шлях:

```text
TODO
  ↓
CLAIMED
  ↓
ACTIVE
  ↓
REVIEW
  ↓
APPROVED
  ↓
MERGE_QUEUED
  ↓
INTEGRATED
  ↓
DONE
```

Deployment task може мати окрему гілку:

```text
INTEGRATED
  ↓
DEPLOY_QUEUED
  ↓
DEPLOYED
  ↓
DONE
```

## 8.1. Заборонені implicit transitions

Ніколи не вважати:

```text
commit created → CLAIMED
tests pass → APPROVED
PR exists → REVIEWED
merged → DEPLOYED
deployed → HEALTHY
```

---

# 9. Ownership та atomic claim

## 9.1. Shared Markdown не є lock

Заборонено покладатися лише на:

```text
read BACKLOG
edit row
commit
push
```

Це не є достатньо надійним механізмом ownership.

`BACKLOG.md` може бути human-readable index, але не єдиним lock authority.

## 9.2. Claim ref

Рекомендований coordination ref:

```text
refs/coordination/claims/<TASK_ID>
```

Claim повинен містити або посилатися на immutable coordination record:

```yaml
task_id: TASK-001
agent_id: agent-foo
fence_token: 7
incarnation: 12
base_sha: <SHA>
branch: task/TASK-001
claimed_utc: <UTC>
lease_until_utc: <UTC>
last_heartbeat_utc: <UTC>
state: ACTIVE
```

## 9.3. Ключова поправка до моделі v3

Git ref update може забезпечити **конкурентний winner selection**, але сам факт існування `fence_token` у JSON/YAML ще не змушує сервер відхилити старого агента.

Тому повинні існувати два рівні:

```text
PROTOCOL RECORD
+
ENFORCEMENT POINT
```

Enforcement point може бути:

```text
server-side hook
CI gate
trusted coordinator
protected branch rule
deployment controller
```

Без enforcement point старий агент може технічно створити commit або push до дозволеної йому гілки.

---

# 10. Claim transaction

Алгоритм:

```text
1. FETCH authoritative state
2. READ task
3. VERIFY eligibility
4. VERIFY no conflicting claim
5. READ current base SHA
6. CREATE claim transaction
7. PERFORM conditional remote create/update
8. RE-READ authoritative state
9. VERIFY ownership
10. CREATE isolated environment
```

Успіх локального `git commit` не означає ownership.

Лише authoritative remote acceptance:

```text
CLAIM_ESTABLISHED
```

## 10.1. Lost response

Сценарій:

```text
request reaches server
server commits state
response is lost
agent sees timeout
```

Заборонено автоматично вважати:

```text
timeout → claim lost
```

Правило:

```text
UNKNOWN RESULT
    ↓
RE-READ AUTHORITATIVE STATE
    ↓
RECONCILE
```

---

# 11. Fence Tokens та Incarnation

`fence_token` — монотонний маркер епохи ownership.

Він потрібен для:

```text
split-brain
stale agent
reclaim race
delayed message
late CI callback
late deployment request
```

При `RECLAIM` або новій incarnation:

```text
fence_token := fence_token + 1
```

Не можна зменшувати token.

## 11.1. Інваріант

Для будь-якої consequential operation:

```text
operation.fence_token == authoritative.fence_token
```

Або, де семантика допускає:

```text
operation.fence_token >= required_min_fence
```

Старі incarnation повинні блокуватися.

## 11.2. Fence enforcement

Критичні точки перевірки:

```text
branch push
review submission
review approval
merge admission
deployment request
runtime mutation
coordination update
```

Перевірка повинна бути authoritative.

## 11.3. Час не є достатнім fencing mechanism

Заборонено покладатися лише на:

```text
local clock
lease expiration by local clock
sleep duration
```

Для ownership decisions потрібні:

```text
authoritative timestamp
version
fence token
CAS / transaction
```

---

# 12. Lease model

Ownership є lease, а не безстроковим правом.

Обов'язкові поля:

```text
task_id
agent_id
fence_token
incarnation
claimed_utc
lease_until_utc
last_heartbeat_utc
base_sha
branch
state
```

Lease parameters повинні бути configuration-driven:

```yaml
lease:
  duration_hours: 24
  heartbeat_minutes: 30
  grace_minutes: 60
```

Не слід зашивати універсальні часові значення як математично правильні для всіх repositories.

---

# 13. Heartbeat та Proof-of-Progress

Heartbeat призначений для liveness, але **heartbeat сам по собі не доводить корисну роботу**.

Помилка попередньої моделі:

```text
HEAD unchanged => stuck
```

є занадто грубою.

Агент може легітимно:

```text
аналізувати складну проблему
чекати CI
дебажити зовнішній сервіс
виконувати довгий build
готувати patch без commit
очікувати dependency
```

Тому Proof-of-Progress має бути багатокласовим.

## 13.1. Дозволені evidence classes

```text
CODE_PROGRESS
TEST_PROGRESS
CI_PROGRESS
ANALYSIS_PROGRESS
ARTIFACT_PROGRESS
ENVIRONMENT_PROGRESS
DEPENDENCY_PROGRESS
COORDINATION_PROGRESS
```

Приклади evidence:

```yaml
proof_of_progress:
  observed_utc: <UTC>
  task_branch_sha: <SHA>
  execution_state_hash: <HASH>
  active_command: "test"
  ci_run_id: <ID>
  changed_paths:
    - foo/**
  evidence_class:
    - TEST_PROGRESS
  next_expected_event_utc: <UTC>
```

## 13.2. Progress не дорівнює зміні SHA

Допустимі сигнали:

```text
new commit
new test result
new CI run
new diagnostic artifact
new accepted dependency result
new review response
new build stage
```

Але evidence повинен бути:

```text
task-related
fresh
verifiable
non-self-contradictory
```

## 13.3. Empty heartbeat

Механічне оновлення:

```text
heartbeat timestamp changed
nothing else changed
```

не повинно нескінченно продовжувати lease.

Але й автоматичний `STUCK` лише через відсутність commit є неправильною політикою.

Правильна модель:

```text
HEARTBEAT
  +
PROGRESS EVIDENCE
  +
TIME BUDGET
  +
STATE RELEVANCE
```

## 13.4. STUCK

Task переходить у `STUCK`, коли одночасно виконуються політично визначені умови:

```text
lease nearing expiry or expired
AND
no valid progress evidence
AND
no active CI/test/build operation
AND
no documented BLOCKED reason
AND
no recent task-related state change
```

---

# 14. Reclaim / Eviction

`RECLAIM` — це не просто timeout.

Перед reclaim необхідно перевірити:

```text
claim ref
fence_token
incarnation
lease_until_utc
last_heartbeat_utc
task branch
latest commit
CI
review
BLOCKED state
deployment state
```

Принцип:

```text
RECLAIM ONLY ON AUTHORITATIVE EVIDENCE
```

## 14.1. Reclaim transaction

```text
READ current claim
VERIFY lease condition
VERIFY no protected active operation
READ current branch state
CREATE new incarnation
INCREMENT fence_token
ATOMically replace ownership
RE-READ authoritative state
VERIFY new ownership
MARK old owner stale
```

## 14.2. Старий агент після reclaim

Старий агент не повинен продовжувати роботу, навіть якщо:

```text
its local clock says lease valid
process remained alive
local network recovered
local branch has new commits
```

Він повинен перевіряти authoritative fence state перед consequential action.

---

# 15. Worktree isolation

Concurrent tasks повинні працювати в окремих worktrees.

Рекомендована форма:

```bash
git worktree add -b task/TASK-001 ../wt-TASK-001 main
```

Перевірка:

```bash
git worktree list --porcelain
```

Правило:

```text
ONE ACTIVE TASK
=
ONE ISOLATED WORKTREE
```

Неприпустимо:

```text
shared mutable working directory
```

---

# 16. Environment isolation

Git isolation не захищає від shared runtime state.

Ізоляції можуть потребувати:

```text
filesystem
/tmp
cache
database
schema
message queue
ports
sockets
uploads
runtime storage
process namespace
container namespace
credentials
cloud resources
```

Приклад нейтральних параметрів:

```text
DB_SCHEMA=agent_task_001
CACHE_PREFIX=agent_task_001
TMPDIR=.../task-001
PORT=18001
```

Ці значення лише приклади. Реальна система повинна генерувати їх із collision-free allocator.

---

# 17. Sandbox boundary

Для `TEST`, `BUILD`, `VERIFY`, генерації коду та інших неповністю довірених процесів рекомендовано:

```text
ephemeral container
unprivileged user
read-only source mounts where possible
restricted network
restricted filesystem
CPU quota
memory quota
process limit
timeout
```

## 17.1. Заборонені implicit capabilities

Процес task не повинен автоматично мати:

```text
production credentials
host docker socket
global git configuration write access
branch protection administration
unrestricted network access
unrestricted filesystem access
other agents' secrets
other tasks' mutable runtime state
```

## 17.2. Git hooks

Локальний hook корисний як додатковий guardrail, але не є повноцінним security boundary.

Заборонено будувати security model лише на:

```text
.git/hooks/pre-push
```

Для реального enforcement потрібні server-side controls.

---

# 18. Path ownership

Task manifest може декларувати:

```yaml
paths:
  - foo/**
  - bar/**

exclusive_paths:
  - database/migrations/**
```

Правило:

```text
overlapping exclusive_paths
→ serialization required
```

Для non-exclusive overlap потрібна оцінка semantic conflict.

Generated files повинні мати owner/source-of-truth.

---

# 19. Protected files та sensitive areas

Рекомендовані protected paths:

```text
.github/workflows/**
CODEOWNERS
MULTI-AGENT.md
specs/architecture/**
specs/security/**
database/migrations/**
deploy/**
production configuration
security policy
release automation
```

Зміни можуть вимагати:

```text
Master approval
CODEOWNER approval
security review
architecture review
```

---

# 20. Database concurrency

Database зміни класифікуються.

```yaml
database:
  schema_change: false
```

або:

```yaml
database:
  schema_change: true
  migration_id: MIG-001
```

## 20.1. Parallel-safe

Типово:

```text
read-only queries
isolated test schema
additive application code
```

## 20.2. Serialized

Типово:

```text
destructive migrations
column rename
table drop
incompatible index change
global seed mutation
shared test database mutation
data migration
```

Не можна дозволяти двом агентам незалежно змінювати одну production schema version.

---

# 21. Testing database

Перевага:

```text
one isolated schema/container per task
```

а не:

```text
one mutable shared DB for all agents
```

SQLite/in-memory не є доказом behavior для engine-specific production semantics.

Для engine-specific behavior потрібен integration test на відповідному DB engine.

---

# 22. Specification-first execution

Перед coding агент повинен пройти:

```text
UNDERSTAND
```

Checklist:

```text
[ ] task manifest read
[ ] acceptance criteria understood
[ ] dependencies verified
[ ] ownership verified
[ ] path conflicts checked
[ ] architecture impact checked
[ ] security impact checked
[ ] deployment impact checked
[ ] database impact checked
[ ] generated files classified
```

При неоднозначності:

```text
BLOCKED
```

Не можна непомітно вигадувати вимоги.

---

# 23. Inspect gate

Перед змінами:

```bash
git status --short --branch
git log --oneline --decorate -20
git diff
git fetch origin --prune
```

Для історичних залежностей:

```bash
git log --follow -- <file>
```

Перед зміною API/contract необхідно знайти:

```text
call sites
consumers
serialization
configuration
authentication
authorization
database contracts
public interfaces
```

---

# 24. Test gate

Для behavioral change:

```text
RED
→
IMPLEMENT
→
GREEN
```

Перший тест повинен, де практично, демонструвати саме відсутність потрібної поведінки.

Для non-behavioral changes:

```text
deterministic validation
```

Наприклад:

```text
schema validator
markdown linter
configuration parser
snapshot comparison
build
static analysis
```

Результат повинен містити:

```text
expected
observed
evidence
```

---

# 25. Implementation gate

Implementation повинна бути:

```text
minimal
scoped
test-backed
reversible
compatible where possible
```

Не змішуйте:

```text
feature
unrelated refactor
cleanup
dependency upgrade
migration
```

без явної потреби.

Незв'язаний defect стає новою task.

---

# 26. Verification gate

Обов'язково виконувати релевантні перевірки.

Базово:

```bash
git diff --check
```

Далі за ризиком:

```text
unit
integration
e2e
static analysis
lint
build
security
configuration validation
schema validation
runtime smoke tests
```

Заборонені докази:

```text
"tests should pass"
"looks fine"
"I think it works"
```

Потрібен actual evidence.

---

# 27. Deterministic build

Build повинен бути прив'язаний до:

```text
SOURCE_SHA
LOCKFILES
TOOLCHAIN_VERSION
DECLARED_CONFIGURATION
```

Уникати:

```text
latest
floating dependency
unrecorded local package
mutable external artifact
```

Production artifact:

```yaml
source_sha: <SHA>
build_id: <ID>
toolchain_version: <VERSION>
artifact_digest: <SHA256>
```

---

# 28. Independent review

Review не дорівнює:

```text
someone looked at diff
```

Review має бути незалежним за контекстом і reasoning.

Типовий цикл:

```text
IMPLEMENTER
   ↓
FRESH REVIEW CONTEXT
   ↓
FINDINGS
   ↓
IMPLEMENTER
   ↓
FRESH REVIEW
```

Для критичних змін:

```text
2 independent reviewers
```

або призначений domain/security expert згідно з політикою repository.

---

# 29. Review scope

Reviewer повинен перевіряти:

```text
Correctness
Concurrency
Security
Data integrity
Failure modes
Compatibility
Observability
Performance
Operational behavior
Rollback
Tests
```

І шукати:

```text
race condition
TOCTOU
idempotency defect
partial failure
retry amplification
stale state
privilege escalation
secret leakage
silent data loss
unsafe fallback
missing timeout
```

---

# 30. Review artifact

Review повинен бути durable artifact.

Рекомендований шлях:

```text
.backlog/reviews/<TASK_ID>/<ITERATION>.md
```

Шаблон:

```md
# Review <TASK_ID> / iteration 1

Base: <SHA>
Head: <SHA>
Fence: <N>
Incarnation: <N>

Decision: PASS

## Critical

## High

## Medium

## Low

## Required changes

## Evidence

## Residual risk

Reviewer: agent-bar
UTC: <timestamp>
```

Chat message не замінює review artifact.

---

# 31. Stale review invalidation

Схвалення, видане для:

```text
BASE_SHA=A
HEAD_SHA=X
```

не є автоматично валідним після зміни integration base.

Наприклад:

```text
main=A
review PASS
main becomes B
task rebased
```

Старе approval повинно бути класифіковане як potential stale.

## 31.1. Semantic Base Validation

Використовуйте рівні перевірки.

### Level 1 — exact identity

```text
base unchanged
head unchanged
```

Review залишається валідним.

### Level 2 — textual dependency check

Перевіряються:

```text
changed files
dependencies
imports
public interfaces
schema
configuration
```

### Level 3 — semantic surface check

За можливості:

```text
AST
API surface
schema surface
configuration surface
contract hash
```

### Level 4 — full re-review

Обов'язковий, якщо зміна потенційно впливає на semantics.

## 31.2. Важлива технічна поправка

`AST/API hash` не є універсальним доказом semantic equivalence.

Hash може не побачити:

```text
runtime configuration
reflection
generated code
dynamic dispatch
external service behavior
data-dependent semantics
timing effects
database state
```

Тому правило:

```text
HASH == EVIDENCE
але
HASH != COMPLETE SEMANTIC PROOF
```

---

# 32. Merge queue

Для concurrent repositories рекомендується merge queue.

Принцип:

```text
PR A tested against main N
PR B tested against main N
A merges
B's prior green result may be stale
```

## 32.1. Speculative integration

Можна використовувати ephemeral ref/branch:

```text
refs/coordination/merge_queue/<QUEUE_ID>
```

Процес:

```text
SELECT next candidate
→ materialize candidate base
→ integrate candidate
→ run required CI
→ validate merge result
→ commit/advance queue
```

## 32.2. Queue invalidation

Якщо candidate fails:

```text
candidate = FAILED
subsequent candidates = REVALIDATION_REQUIRED
```

Не обов'язково скасовувати всі попередні кандидати.

Кожен candidate повинен мати:

```text
tested_base_sha
candidate_head_sha
queue_position
ci_run_id
result
```

---

# 33. Optimistic concurrency

Загальний шаблон:

```text
READ version N
MODIFY expecting N
COMMIT only if still N
```

При mismatch:

```text
RECONCILE
→ RETRY OR REJECT
```

Не можна:

```text
blind overwrite
```

Цей принцип застосовується до:

```text
claims
state transitions
coordination records
deployment state
runtime configuration
```

---

# 34. TOCTOU

Усі consequential operations повинні перевіряти TOCTOU.

Замість:

```text
CHECK
→ time passes
→ ACT
```

перевага:

```text
ATOMIC OPERATION
```

або:

```text
CHECK + VERSION + ACT
```

або:

```text
TRANSACTION
```

Особливо важливо для:

```text
authorization
filesystem
deployment
schema
resource allocation
security controls
branch state
```

---

# 35. Idempotency

Повторний запуск automation повинен бути безпечним.

Перевірити сценарії:

```text
deploy twice
retry API request
rerun migration
restart worker
repeat cleanup
repeat claim reconciliation
repeat artifact publication
```

За можливості використовувати:

```text
idempotency_key
operation_id
transaction_id
```

---

# 36. Retry policy

Ніколи не використовувати нескінченні blind retries.

Потрібні:

```text
bounded retries
exponential backoff
jitter
error classification
timeout
circuit breaking where appropriate
```

Класифікація:

```text
TRANSIENT
PERMANENT
UNKNOWN
```

`UNKNOWN` за замовчуванням повинен вести до safe stop або контрольованої ручної/authoritative reconciliation.

---

# 37. Failure matrix

Для кожної consequential operation документувати:

| Подія | Очікувана реакція |
|---|---|
| process dies before commit | preserve task state; no fake completion |
| process dies after commit | commit remains recoverable |
| request times out | re-read authoritative state |
| remote accepted but response lost | reconcile; do not duplicate blindly |
| two agents claim simultaneously | one wins; loser rereads |
| lease expires | reclaim rules apply |
| old agent wakes after reclaim | fence check rejects consequential action |
| CI callback is delayed | validate fence/base before applying result |
| merge queue base changes | revalidation |
| deployment partially succeeds | hold/rollback according to deployment contract |
| runtime health fails | stop/rollback/escalate |
| coordination metadata corrupts | reconstruct from durable evidence |

---

# 38. Artifact integrity

Критичні artifacts повинні мати digest.

Рекомендовано:

```text
SHA-256
```

Записувати:

```yaml
artifact: foo.zip
digest: <SHA256>
source_sha: <SHA>
build_id: <ID>
created_utc: <UTC>
```

Файл імені недостатньо для identity.

---

# 39. Secrets

Не commit:

```text
.env
credentials
tokens
private_keys
production dumps
session cookies
runtime secrets
```

Репозиторій може містити:

```text
.env.example
```

але не реальні production secrets.

До integration:

```text
secret scan
dependency security scan
policy validation
```

---

# 40. API та schema evolution

Для public contracts оцінювати разом:

```text
producer
consumer
compatibility
migration
rollback
```

Переважний шлях:

```text
ADD
→ MIGRATE
→ DEPRECATE
→ REMOVE
```

а не:

```text
BREAK IMMEDIATELY
```

якщо breaking change не є явною вимогою.

---

# 41. Configuration changes

Кожна configuration change повинна декларувати:

```text
default
source of production value
validation
backward compatibility
failure behavior
secret classification
rollback
```

Небезпечно мовчки змінювати:

```text
security-sensitive defaults
timeouts
access policy
network exposure
CORS
authentication
authorization
logging of secrets
```

---

# 42. Deployment як privileged state transition

Deployment — окрема consequential operation.

Перед deployment повинні бути відомі:

```text
exact source SHA
build identity
artifact digest
authorization
target environment
rollback target
```

Golden flow:

```text
SOURCE
  ↓
BUILD
  ↓
VERIFY ARTIFACT
  ↓
DRY-RUN
  ↓
AUTHORIZE
  ↓
DEPLOY
  ↓
HEALTH
  ↓
SMOKE
  ↓
OBSERVE
  ↓
RECORD
```

---

# 43. Deployment path safety

Не можна припускати:

```text
server absolute path
=
account-relative deployment path
```

Перед upload/transport потрібно реально підтвердити:

```text
remote account root
effective destination
path normalization
path traversal safety
```

Ніколи не копіювати конкретні production paths у цей універсальний протокол.

Нейтральний приклад:

```text
remote_root=/
deploy_path=/bar
```

---

# 44. Secure transport

Для remote deployment транспорт повинен відповідати security policy.

Приклад policy:

```text
TLS required
certificate validation required
credentials external
```

Заборонено мовчки downgrade до insecure transport через failure.

---

# 45. Runtime verification

Мінімальний generic smoke suite:

```text
health endpoint
critical route
authentication boundary
authorization boundary
critical API
static assets
security-sensitive paths
```

Нейтральний приклад:

```text
GET /health
GET /api/health
GET /api/does-not-exist
GET /internal/forbidden-example
```

Очікувані results повинні визначатися task-specific acceptance criteria, а не цим universal protocol.

---

# 46. Rollback contract

Кожен production deployment має мати:

```text
known_good_source_sha
artifact_digest
deployment_id
deployment_timestamp
rollback_target
rollback_procedure
```

Заборонено:

```text
"rollback to previous version"
```

без exact identity версії.

---

# 47. Observability

Production-affecting change повинна визначати, де можливо:

```text
logs
metrics
traces
errors
latency
health
alerts
correlation_id
```

Система, яку неможливо діагностувати після deployment, операційно незавершена.

---

# 48. Data safety

Для tasks, що торкаються production/user data:

```text
read scope
write scope
backup/recovery
retention
rollback
validation
audit
```

Bulk mutation:

```text
DRY-RUN
→ SAMPLE VALIDATION
→ BOUNDED EXECUTION
→ POST-CHECK
```

Destructive operation потребує explicit authorization, якщо політика це визначає.

---

# 49. Human-in-the-loop boundary

Рекомендовано вимагати human authorization для:

```text
production deploy
production data mutation
destructive schema change
credential rotation
security-policy relaxation
branch protection change
irreversible operation
```

Automation може підготувати операцію.

Authorization санкціонує state transition.

---

# 50. Capability matrix

Task manifest:

```yaml
capabilities_required:
  - CODE
  - TEST
```

Sensitive task:

```yaml
capabilities_required:
  - CODE
  - SECURITY
  - DEPLOY
```

Агент без required capability не може виконувати task.

Role та capability — різні концепції:

```text
ROLE != CAPABILITY
```

---

# 51. Exclusive operations

Деякі operations повинні бути serialized навіть якщо файли не перетинаються.

Приклади:

```text
production deployment
branch protection update
schema migration
credential rotation
release cut
shared infrastructure mutation
security policy change
```

У manifest:

```yaml
exclusive_operation: true
resource_lock: RELEASE
```

Один resource lock — один active owner.

---

# 52. Safe parallelism

Мета масштабування:

```text
safe concurrency
```

а не:

```text
maximum concurrency at any cost
```

Зі збільшенням кількості агентів мають зростати:

```text
isolated worktrees
CI capacity
review throughput
queue capacity
resource quotas
```

а не:

```text
shared mutable state
ownership ambiguity
race frequency
```

---

# 53. Main branch invariants

`main` повинен мати:

```text
protected branch
required CI
required review
no direct unreviewed pushes
auditable integration
known resulting SHA
```

Незалежно від ролі:

```text
NO UNREVIEWED INTEGRATION
```

---

# 54. Hooks та CI

Локальні hooks — defense in depth.

CI/server-side controls — authoritative enforcement.

Критичні policy checks повинні бути machine-enforced там, де це можливо:

```text
branch protection
required checks
required review
secret scanning
dependency policy
artifact verification
deployment authorization
fence validation
```

---

# 55. Machine-enforceable policy

Рекомендований набір control points:

```text
agentctl doctor
agentctl task validate <TASK_ID>
agentctl claim <TASK_ID>
agentctl heartbeat <TASK_ID>
agentctl reclaim <TASK_ID>
agentctl review <TASK_ID>
agentctl merge-check <TASK_ID>
agentctl deploy-check <TASK_ID>
agentctl doctor
```

Ці команди є **нейтральними інтерфейсними назвами**; реалізація може мати інший CLI, якщо семантика зберігається.

---

# 56. Doctor command

`agentctl doctor` повинен перевіряти щонайменше:

```text
repository connectivity
Git version
worktree health
current branch
dirty state
task metadata integrity
coordination refs
agent identity
capability policy
required tooling
sandbox availability
clock sanity
CI reachability
```

Результат:

```text
PASS
WARN
FAIL
UNKNOWN
```

`UNKNOWN` не повинен трактуватися як `PASS`.

---

# 57. Task validation

До claim:

```text
task exists
state == TODO
dependencies satisfied
paths valid
exclusive paths free
required capabilities available
risk classified
review policy valid
lease parameters valid
deployment requirements valid
```

---

# 58. Claim validation

Після claim:

```text
authoritative claim exists
agent_id matches
fence_token matches
incarnation matches
base_sha recorded
lease valid
branch identity valid
```

Після network uncertainty:

```text
RE-VALIDATE
```

---

# 59. Crash recovery

Якщо агент зник:

```text
1. inspect claim
2. inspect lease
3. inspect fence token
4. inspect branch
5. inspect commits
6. inspect CI
7. inspect review
8. inspect deployment
9. determine recoverability
10. reclaim only under policy
11. preserve valid commits
```

Ніколи не припускати:

```text
process gone => work lost
```

---

# 60. Remote outage recovery

Якщо authoritative remote недоступний:

```text
do not fabricate ownership
do not fabricate approval
do not advertise authoritative CLAIMED
do not mutate another task
```

Вже authoritative claimed task можна локально продовжувати лише в межах risk policy, але consequential remote transitions повинні чекати authoritative confirmation.

Після відновлення:

```text
FETCH
→ RECONCILE
→ VERIFY FENCE
→ VERIFY BASE
→ CONTINUE
```

---

# 61. Corrupted coordination state

Якщо task metadata суперечлива:

```text
Git refs/history
    ↓
task artifacts
    ↓
CI/review evidence
    ↓
runtime evidence
    ↓
metadata repair
```

Repair має бути:

```text
auditable
versioned
reviewed where appropriate
```

Не можна silently rewrite history лише для приховування coordination error.

---

# 62. Garbage Collection coordination refs

Кожна coordination record має lifecycle.

```text
ACTIVE
  ↓
TERMINAL
  ↓
ARCHIVE
  ↓
GC
```

Порядок:

```text
1. verify terminal state
2. archive durable manifest
3. preserve required audit metadata
4. remove obsolete ref
5. remove obsolete branch where policy allows
6. verify absence/preservation
```

Приклад:

```text
archive/.backlog/archive/<TASK_ID>.json
refs/coordination/claims/<TASK_ID>
refs/coordination/reviews/<TASK_ID>/<ITERATION>
```

GC не повинен знищувати необхідні audit records.

---

# 63. BACKLOG.md policy

`BACKLOG.md` може бути:

```text
human-facing index
summary
navigation aid
```

але ownership authority має бути:

```text
coordination ref
task manifest
Git history
CI/review state
```

Не робіть великий Markdown table єдиним concurrency hotspot.

---

# 64. Architecture Decision Records

Для significant architecture changes:

```text
specs/architecture/ADR-<NNN>-<slug>.md
```

Мінімум:

```text
Context
Decision
Alternatives
Consequences
Rejected options
Migration
Rollback
Security implications
Operational implications
```

---

# 65. Change classification

Кожна task повинна мати:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Орієнтовно:

```text
LOW
  documentation
  isolated tests
  trivial local changes

MEDIUM
  local behavior
  non-critical API
  moderate operational effect

HIGH
  authentication
  authorization
  database
  infrastructure
  security-sensitive code

CRITICAL
  production access
  destructive data operation
  credentials
  security boundaries
  release infrastructure
  irreversible changes
```

---

# 66. Risk-adaptive review

Базова policy:

```text
LOW
  → 1 review

MEDIUM
  → 1 independent review

HIGH
  → 2 independent reviews OR designated expert

CRITICAL
  → owner review
  + security/architecture review where relevant
  + required CI
  + explicit authorization
```

Repository може посилити вимоги.

Risk не можна зменшувати лише для throughput.

---

# 67. Generated files

Артефакти класифікуються:

```text
SOURCE
DERIVED
BUILD
RUNTIME
```

Лише source normally hand-edited.

Для кожного generated output знати:

```text
source-of-truth
generator
reproducibility
whether checked into Git
```

---

# 68. Dependency updates

Dependency change повинна містити:

```text
lockfile update
compatibility verification
security scan
license/policy validation where applicable
reproducible build evidence
```

Не змішувати з unrelated work без потреби.

---

# 69. HTTP integration testing

Для routing/security changes потрібен реальний HTTP behavior, а не лише unit tests.

Перевіряти:

```text
status
headers
content type
body shape
authentication
authorization
security boundaries
```

Нейтральні приклади:

```text
GET /api/health
GET /api/does-not-exist
GET /internal/example
```

Конкретні expected codes визначаються task contract.

---

# 70. Local/production parity

Якщо production має routing, proxy, TLS, WAF, auth gateway або інший infrastructure layer, local success не доводить production behavior.

Потрібно розрізняти:

```text
LOCAL SEMANTICS
PRODUCTION EFFECTIVE SEMANTICS
```

Smoke test повинен перевіряти саме effective behavior.

---

# 71. Security baseline

Для web/API systems security behavior є частиною acceptance criteria.

Приклади:

```text
authenticated endpoints require authentication
authorization enforced server-side
internal files not public
debug disabled in production
secure cookie attributes where applicable
secrets not logged
error responses do not disclose sensitive internals
```

---

# 72. Production secret separation

Production secrets належать runtime/environment.

Репозиторій може містити templates:

```text
.env.example
```

але production secret values повинні бути externalized.

Deployment artifact не повинен випадково містити:

```text
.env
runtime storage
secret cache
credentials
session material
production dumps
```

---

# 73. Deployment transaction state machine

Рекомендована state machine:

```text
NOT_READY
  ↓
BUILD_READY
  ↓
VERIFIED
  ↓
AUTHORIZED
  ↓
DEPLOYING
  ↓
DEPLOYED_UNVERIFIED
  ↓
HEALTHY
```

Failure:

```text
DEPLOYING
  ↓
FAILED
  ↓
ROLLBACK or HOLD
```

Заборонено автоматично перетворювати:

```text
DEPLOYED_UNVERIFIED → HEALTHY
```

без actual evidence.

---

# 74. Merge / deploy fence

Будь-який delayed automation callback повинен перевіряти:

```text
task_id
source_sha
base_sha
fence_token
incarnation
operation_id
```

Перед update state:

```text
VERIFY CURRENT AUTHORITATIVE STATE
```

Це захищає від stale CI callback та stale deployment callback.

---

# 75. Operation IDs

Кожна consequential operation повинна мати унікальний:

```text
operation_id
```

Приклад:

```yaml
operation_id: op-foo-001
task_id: TASK-001
fence_token: 7
incarnation: 12
source_sha: <SHA>
```

Це підвищує idempotency та auditability.

---

# 76. Distributed-work checklist

Перед кожною consequential action задати:

```text
What if process dies here?
What if network dies here?
What if another agent changes the resource now?
What if the command succeeds but response is lost?
What if request runs twice?
What if state is partially updated?
What if this callback is stale?
What if the clock is wrong?
```

Якщо відповідь не формалізована:

```text
BLOCK
```

---

# 77. Formal invariants

## I1 — Single ownership

```text
ACTIVE(T)
→ at most one authoritative owner
```

## I2 — Current fence

```text
consequential_operation
→ current authoritative fence required
```

## I3 — Isolated execution

```text
parallel ACTIVE(T)
→ isolated worktree + isolated mutable runtime state
```

## I4 — No unreviewed integration

```text
main ← only approved changes
```

## I5 — No implicit deployment

```text
merge != deploy
```

## I6 — No unknown security state

```text
security uncertainty → STOP
```

## I7 — Reproducibility

```text
artifact
→ source_sha + build_identity + digest
```

## I8 — Safe recovery

```text
agent crash
→ committed work remains recoverable
```

## I9 — Stale callback rejection

```text
callback.fence_token != current.fence_token
→ reject or quarantine
```

## I10 — No blind overwrite

```text
version mismatch
→ reconcile/retry/reject
```

---

# 78. State transition guards

Кожна state transition повинна мати:

```text
PRECONDITIONS
ACTION
POSTCONDITIONS
EVIDENCE
ROLLBACK/RECOVERY
```

Приклад:

```text
ACTIVE → REVIEW

Pre:
  owner valid
  fence valid
  acceptance satisfied
  required tests pass
  no unexpected diff
  required artifacts exist

Action:
  publish branch
  publish handoff
  publish review artifact

Post:
  state=REVIEW
  exact HEAD recorded

Evidence:
  commit
  test logs
  review artifact
  state transition record
```

---

# 79. Review invalidation matrix

| Зміна | Review status |
|---|---|
| exact same base/head | valid |
| metadata-only change | policy-dependent |
| task branch commit changed | invalid |
| base branch changed materially | revalidation required |
| API contract changed | review invalid |
| schema contract changed | review invalid |
| security-sensitive dependency changed | review invalid |
| generated artifact changed due to deterministic rebuild | policy-dependent |
| unrelated change outside dependency cone | potentially valid, must be machine-justified |

Ніколи не використовувати лише:

```text
"diff looks similar"
```

---

# 80. Lease/reclaim matrix

| Стан | Heartbeat | Progress | Lease | Action |
|---|---|---|---|---|
| ACTIVE | fresh | fresh | valid | continue |
| ACTIVE | fresh | weak | valid | warning / inspect |
| ACTIVE | fresh | absent | valid | no automatic reclaim yet |
| ACTIVE | stale | fresh recent | valid | reconcile |
| ACTIVE | stale | absent | expired | reclaim eligible |
| BLOCKED | fresh | N/A | policy-dependent | do not steal blindly |
| REVIEW | fresh | N/A | policy-dependent | review owns lifecycle |
| MERGE_QUEUED | callback pending | CI active | special | do not reclaim as coding task |

---

# 81. Merge queue recovery

Якщо candidate у merge queue падає:

```text
MARK candidate failed
PRESERVE evidence
INVALIDATE affected downstream candidates
RECALCULATE base
REVALIDATE
REQUEUE
```

Не потрібно безумовно "скидати всю чергу".

Метою є:

```text
minimum necessary revalidation
```

без втрати correctness.

---

# 82. Split-brain scenario

Сценарій:

```text
Agent A owns fence 4
network partition
reclaim creates fence 5
Agent A resumes
```

Повинен відбутися:

```text
A reads authoritative fence
4 < 5
A becomes STALE
A stops consequential operations
A preserves local work
A performs recovery/handoff
```

Ніколи:

```text
A keeps pushing because local branch is valid
```

---

# 83. Phantom lock scenario

Сценарій:

```text
agent sends claim request
remote succeeds
response lost
```

Правильний результат:

```text
state = UNKNOWN
→ read authoritative claim
→ either OWNER or NOT_OWNER
```

Не створювати новий claim лише через network timeout.

---

# 84. Shared-state pollution scenario

Якщо task запускає:

```text
hard-coded /tmp path
hard-coded port
global daemon
shared DB
shared cache
```

це security/coordination defect.

Policy:

```text
STOP
ISOLATE
CLEAN
RECLASSIFY
```

Заборонено "сподіватися", що паралельний агент цього не помітить.

---

# 85. Privilege escalation scenario

Untrusted generated code може спробувати:

```text
push main
rewrite git config
read sibling secrets
access production network
delete another worktree
modify CI
```

Controls:

```text
least privilege
sandbox
server-side Git controls
protected branches
network restriction
filesystem restriction
secret isolation
audit logs
```

Локальний агент policy без infrastructure enforcement не є достатнім.

---

# 86. Review loop limits

Нормальна review loop повинна мати bounded policy.

Наприклад:

```text
max_iterations = 3
```

Після систематичного failure:

```text
BLOCKED
```

і створюється decision artifact:

```text
.backlog/decisions/<TASK_ID>-halt.md
```

Містить:

```text
problem
attempts
evidence
remaining uncertainty
risk
recommended decision
```

Це перешкоджає безкінечній mutation заради формального PASS.

---

# 87. Handoff contract

Handoff повинен містити:

```text
TASK_ID
STATE
OWNER
FENCE_TOKEN
INCARNATION
BASE_SHA
HEAD_SHA
BRANCH
CHANGED_AREAS
TESTS
REVIEW
KNOWN_RISKS
OPEN_QUESTIONS
NEXT_ACTION
ARTIFACTS
```

Нейтральний приклад:

```text
TASK_ID=TASK-001
STATE=REVIEW
OWNER=agent-foo
FENCE_TOKEN=7
INCARNATION=12
BASE_SHA=<SHA>
HEAD_SHA=<SHA>
BRANCH=task/TASK-001
TESTS=PASS
REVIEW=.backlog/reviews/TASK-001/2.md
RISK=MEDIUM
NEXT_ACTION=review/integrate
```

---

# 88. Commit protocol

Рекомендований формат:

```text
<type>(<scope>): <summary>
```

Типи:

```text
feat
fix
test
refactor
docs
chore
perf
security
build
ci
```

Task linkage:

```text
Task: TASK-001
```

Приклад:

```text
fix(auth): rotate session identifier

Task: TASK-001
```

Atomic commits бажані, але не забороняється squash/rebase policy repository.

---

# 89. Branch model

Typical:

```text
task/<TASK_ID>
hotfix/<TASK_ID>
release/<VERSION>
```

Feature work не робиться напряму у protected `main`.

---

# 90. Rebase policy

Перед integration:

```bash
git fetch origin
git rebase origin/main
```

Після rebase необхідно перевірити:

```text
base identity
HEAD identity
tests
semantic dependency impact
review validity
fence validity
```

Rebase не означає автоматично:

```text
review still valid
```

---

# 91. Conflict handling

Textual conflict ≠ semantic conflict.

Алгоритм:

```text
STOP
→ INSPECT BOTH INTENTS
→ RESOLVE
→ TEST
→ REVIEW
→ CONTINUE
```

Заборонено blind resolution:

```text
ours
theirs
latest
```

без semantic understanding.

---

# 92. Release

Нормальний release:

```text
APPROVED
→ MERGE_QUEUED
→ INTEGRATED
→ BUILD
→ VERIFY ARTIFACT
→ AUTHORIZE
→ DEPLOY
→ HEALTH
→ SMOKE
→ RECORD
```

Release artifact має бути traceable до exact SHA.

---

# 93. Abandonment

При abandonment:

```text
state = ABANDONED
```

Записати:

```text
reason
latest_sha
test_status
review_status
known_risks
recovery_notes
fence_token
```

Не видаляти мовчки branch з цінною роботою.

---

# 94. Finalization

`DONE` означає:

```text
[ ] acceptance criteria satisfied
[ ] dependencies satisfied
[ ] implementation complete
[ ] tests PASS
[ ] static checks PASS
[ ] security checks PASS where applicable
[ ] review PASS
[ ] review artifact durable
[ ] branch integrated
[ ] final SHA recorded
[ ] coordination state consistent
[ ] required runtime evidence recorded
```

Для deployment task додатково:

```text
[ ] build identified
[ ] artifact digest recorded
[ ] authorization recorded
[ ] dry-run PASS
[ ] deployment PASS
[ ] health PASS
[ ] smoke PASS
[ ] rollback target recorded
```

---

# 95. Agent startup procedure

```text
1. identify AGENT_ID
2. identify ROLE
3. run agentctl doctor
4. fetch authoritative state
5. inspect worktrees
6. inspect task manifests
7. inspect claims
8. inspect dependencies
9. inspect capabilities
10. choose eligible task
11. claim atomically
12. verify remote ownership
13. verify fence_token
14. create isolated worktree
15. create isolated runtime state
16. begin UNDERSTAND gate
```

---

# 96. Agent completion procedure

```text
1. verify known working state
2. run required tests
3. run security checks
4. record evidence
5. prepare review artifact
6. complete independent review
7. update handoff
8. push task branch
9. verify remote state
10. transition to REVIEW
11. stop unless explicitly authorized to integrate
```

---

# 97. Master integration procedure

```text
1. fetch origin
2. verify authoritative task state
3. verify owner/fence/incarnation
4. verify review validity
5. verify CI
6. verify branch freshness
7. inspect final diff
8. run merge admission checks
9. integrate through protected mechanism
10. verify resulting main SHA
11. record final SHA
12. transition INTEGRATED/DONE
13. perform coordination GC when eligible
```

---

# 98. Master deployment procedure

Only with explicit authorization:

```text
1. identify exact source SHA
2. verify fence and operation id
3. build exact SHA
4. verify artifact digest
5. run dry-run
6. verify target environment
7. authorize
8. execute deploy
9. verify deployment result
10. run health
11. run smoke
12. inspect logs/metrics
13. record deployment
14. preserve rollback target
```

---

# 99. Emergency procedure

Emergency mode лише для:

```text
outage
security incident
data corruption
critical production failure
```

Flow:

```text
FREEZE NORMAL WORK
→ IDENTIFY INCIDENT
→ CREATE HOTFIX TASK
→ MINIMIZE CHANGE
→ TEST
→ REVIEW WHEN PRACTICAL
→ AUTHORIZE
→ DEPLOY
→ VERIFY
→ DOCUMENT
```

Emergency не означає:

```text
ignore history
delete evidence
disable all security
force-push casually
skip audit
```

---

# 100. Anti-patterns

Заборонені:

```text
shared mutable worktree
chat-only ownership
local-only ownership
blind merge
blind retries
infinite retries
infinite review loop
shared mutable DB without isolation
fake heartbeat
stale agent mutation after reclaim
unverified deployment
implicit deployment
secret in repository
force-push to win ownership
silent metadata rewrite
```

---

# 101. Compatibility modes

## Mode A — Full

```text
task manifests
coordination refs
fence tokens
incarnation
agentctl
worktrees
sandbox
CI
protected main
review
merge queue
deployment gates
runtime verification
```

## Mode B — Git-centric

```text
task manifests
coordination refs
fence tokens
task branches
review artifacts
protected main
```

## Mode C — Legacy fallback

Тільки за відсутності coordination infrastructure:

```text
BACKLOG.md
task branches
atomic push
review artifacts
```

`Mode C` — compatibility fallback, не рекомендована цільова архітектура.

---

# 102. Migration from legacy protocol

Перевага — staged migration:

```text
Phase 1
  BACKLOG.md remains index

Phase 2
  create .backlog/tasks/

Phase 3
  introduce coordination refs

Phase 4
  introduce fence tokens/incarnation

Phase 5
  introduce worktree isolation

Phase 6
  introduce CI/review protection

Phase 7
  introduce merge queue

Phase 8
  introduce deployment gates

Phase 9
  enforce policy automatically
```

Не виконувати destructive migration під час активної конкурентної роботи.

---

# 103. Protocol versioning

Зміни протоколу вимагають review.

Semantic versioning:

```text
MAJOR = change in authority/ownership/state semantics
MINOR = new optional capability or stronger enforcement
PATCH = clarification without behavior change
```

Приклад:

```text
docs(protocol): clarify reclaim semantics
feat(protocol): add fence enforcement
chore(protocol): clarify review invalidation
```

---

# 104. Universal placeholder policy

Цей документ не повинен містити project-specific:

```text
project names
private URLs
real domains
real hosts
real filesystem paths
real credentials
real ports unless explicitly generic
real service identifiers
```

Для прикладів використовувати:

```text
foo
bar
example.com
TASK-001
agent-foo
agent-bar
/api/health
/internal/example
```

Будь-яка конкретна deployment/network/database detail належить project-specific configuration, а не universal protocol.

---

# 105. What this protocol does not guarantee

Протокол не гарантує:

```text
perfect semantic equivalence
bug-free agents
correct AI reasoning
correctness of external systems
availability of remote Git
availability of CI
availability of deployment target
truth of a compromised trusted coordinator
```

Він гарантує лише те, що його enforcement points реально enforce.

Отже:

```text
DOCUMENTED POLICY
    ≠
ENFORCED POLICY
```

Нормативний рівень:

```text
POLICY
+
MACHINE ENFORCEMENT
+
DURABLE EVIDENCE
=
ACTUAL CONTROL
```

---

# 106. Auditability

Для кожної consequential operation бажано мати:

```yaml
operation_id: op-foo-001
task_id: TASK-001
agent_id: agent-foo
role: slave
fence_token: 7
incarnation: 12
base_sha: <SHA>
head_sha: <SHA>
action: REVIEW
started_utc: <UTC>
completed_utc: <UTC>
result: PASS
evidence:
  - <artifact-or-record>
```

Audit record не повинен містити секретів.

---

# 107. Formal safety/liveness split

Протокол повинен розрізняти:

## Safety

```text
nothing bad happens
```

Наприклад:

```text
two authoritative owners cannot simultaneously hold the same fence
unreviewed change cannot enter protected main
stale callback cannot mutate current state
unapproved deployment cannot be considered authorized
```

## Liveness

```text
something good eventually happens
```

Наприклад:

```text
healthy task eventually gets reviewed
expired ownership can eventually be reclaimed
deployment can eventually complete or fail terminally
```

Safety має пріоритет над liveness.

У сумнівній ситуації:

```text
SAFE STOP
```

кращий за небезпечне продовження.

---

# 108. Core race catalogue

Система повинна розглядати щонайменше:

```text
claim-vs-claim race
claim-vs-reclaim race
heartbeat-vs-reclaim race
reclaim-vs-reclaim race
push-vs-rebase race
review-vs-new-base race
merge-vs-merge race
CI callback-vs-new-commit race
deploy callback-vs-rollback race
GC-vs-late-audit race
```

Для кожної race повинно бути:

```text
authority
version/fence
atomic boundary
failure outcome
reconciliation path
```

---

# 109. Core stale-state catalogue

Stale data може бути:

```text
stale task manifest
stale Git fetch
stale claim
stale lease
stale branch
stale review
stale CI status
stale artifact
stale deployment target
stale runtime health
```

Правило:

```text
STALE STATE MUST NOT AUTHORIZE CONSEQUENTIAL ACTION
```

---

# 110. Coordination ref lifecycle

Рекомендована модель:

```text
refs/coordination/
  claims/
  queue/
  reviews/
  operations/
```

Приклад:

```text
refs/coordination/claims/TASK-001
refs/coordination/queue/merge-001
refs/coordination/reviews/TASK-001/2
refs/coordination/operations/op-foo-001
```

Назви — рекомендований нейтральний namespace, а не жорстко обов'язкова єдина топологія.

---

# 111. Claim record schema

Рекомендований machine-readable schema:

```yaml
schema_version: "4.0"
task_id: TASK-001
agent_id: agent-foo
role: slave

fence_token: 7
incarnation: 12

state: ACTIVE

base_sha: <SHA>
branch: task/TASK-001

claimed_utc: <UTC>
lease_until_utc: <UTC>
last_heartbeat_utc: <UTC>

proof_of_progress:
  evidence_class:
    - CODE_PROGRESS
  task_branch_sha: <SHA>
  execution_state_hash: <HASH>
  ci_run_id: null

operation_id: op-foo-001
protocol_version: "4.0"
```

---

# 112. Transition record schema

Кожна важлива transition може мати:

```yaml
operation_id: op-bar-002
task_id: TASK-001
from_state: ACTIVE
to_state: REVIEW

agent_id: agent-foo
fence_token: 7
incarnation: 12

base_sha: <SHA>
head_sha: <SHA>

preconditions:
  - acceptance_satisfied
  - tests_passed
  - review_artifact_present

result: PASS

evidence:
  - .backlog/reviews/TASK-001/1.md

occurred_utc: <UTC>
```

---

# 113. Property-based / adversarial validation

Перед production adoption рекомендується тестувати сам protocol implementation.

Мінімальні сценарії:

```text
two simultaneous claims
lost claim response
duplicate claim request
reclaim during heartbeat
heartbeat after reclaim
late CI callback
stale review after rebase
merge queue candidate failure
deployment timeout after remote success
duplicate deployment command
GC while delayed callback exists
corrupted coordination record
network partition between agents
agent restart with stale local state
```

Мета:

```text
validate invariants
not merely happy paths
```

---

# 114. Protocol conformance tests

Implementation should have conformance tests such as:

```text
test_single_owner
test_fence_monotonicity
test_stale_agent_rejected
test_lost_response_reconciled
test_review_invalidated_on_semantic_base_change
test_merge_queue_revalidation
test_duplicate_operation_idempotent
test_deploy_requires_authorization
test_unknown_state_fails_closed
test_gc_preserves_audit
```

---

# 115. Safety-first error semantics

Рекомендовані result categories:

```text
SUCCESS
REJECTED
CONFLICT
STALE
UNKNOWN
RETRYABLE
FATAL
BLOCKED
```

Особливо:

```text
UNKNOWN
```

не можна мапити на:

```text
SUCCESS
```

---

# 116. Final golden flow

```text
DISCOVER
   ↓
VALIDATE
   ↓
CLAIM
   ↓
VERIFY OWNERSHIP
   ↓
FENCE
   ↓
ISOLATE
   ↓
UNDERSTAND
   ↓
TEST
   ↓
IMPLEMENT
   ↓
VERIFY
   ↓
INDEPENDENT REVIEW
   ↓
APPROVE
   ↓
REVALIDATE BASE
   ↓
MERGE QUEUE
   ↓
INTEGRATE
   ↓
VERIFY MAIN
   ↓
AUTHORIZE DEPLOY
   ↓
DEPLOY
   ↓
VERIFY RUNTIME
   ↓
RECORD
   ↓
GC WHEN SAFE
```

Критичний failure:

```text
STOP
BLOCK
RECONCILE
ROLLBACK
```

а не silent continuation.

---

# 117. Final operational law

```text
AUTHORITY is not QUALITY.
CLAIM is not IMPLEMENTATION.
IMPLEMENTATION is not VERIFICATION.
VERIFICATION is not REVIEW.
REVIEW is not APPROVAL.
APPROVAL is not INTEGRATION.
INTEGRATION is not DEPLOYMENT.
DEPLOYMENT is not HEALTH.
HEALTH is not COMPLETE BUSINESS CORRECTNESS.
```

І фундаментально:

```text
NO CONSEQUENTIAL OPERATION
WITHOUT DURABLE EVIDENCE
OF AUTHORITY, PRECONDITIONS, RESULT, AND RECOVERY STATE.
```

А для конкурентної координації:

```text
NO OWNERSHIP WITHOUT AUTHORITATIVE CLAIM.
NO OLD OWNER AFTER FENCE ADVANCES.
NO TRUST IN STALE CALLBACKS.
NO BLIND RETRY.
NO IMPLICIT DEPLOYMENT.
NO UNKNOWN STATE AS SUCCESS.
```

**Master, Slave, human та automation працюють в одному протоколі. Відрізняються лише дозволені transition-и та capabilities.**

---
