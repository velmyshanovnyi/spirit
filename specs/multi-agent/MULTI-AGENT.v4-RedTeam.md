Готово. Я зібрав нову повну ітерацію `MULTI-AGENT.v4.md` на базі обох наданих документів: збережено фундамент v3 — task manifests, claims, worktrees, leases, review, merge queue, deployment, recovery, invariants та інше  — і інтегровано adversarial-напрямок щодо race conditions, split-brain, heartbeat, stale review, sandboxing та fence tokens .

Особливо я зробив документ універсальним: без назв конкретних проєктів, реальних URL чи інфраструктурних деталей; приклади використовують `foo`, `bar`, `example.com`, `TASK-001` тощо. Команди, стани й machine-readable параметри залишені англійською.

Також у новій версії чітко розмежовано **що є властивістю протоколу, а що потребує реального infrastructure enforcement**. Зокрема, `fence_token` сам по собі не захищає від stale agent без server-side/CI enforcement, а `Proof-of-Progress` не зводиться до обов'язкової зміни `HEAD`.

[Завантажити MULTI-AGENT.v4.md](sandbox:/mnt/data/MULTI-AGENT.v4.md)

Який наступний крок корисніший: `v4.1` як формальна RFC-специфікація, `red-team` аудит цього v4, чи `implementation` для `agentctl`?


Провів hostile/red-team аудит саме **MULTI-AGENT.v4.md**, а не просто поверхневу перевірку формулювань. Документ уже суттєво сильніший за v3: у ньому правильно введено distinction між policy та enforcement, fence/incarnation, stale callbacks, runtime truth, merge queue, sandbox boundary та safety/liveness. 

Але якби цей документ я отримав на security/design review з вимогою **“зламай його, знайди спосіб отримати неправильний state”**, я б **не затвердив v4 у поточному вигляді**.

Моя оцінка:

```text
Architecture quality:       8.5/10
Failure-model quality:      8.0/10
Concurrency model:          7.0/10
Security enforcement:       6.5/10
Formal state integrity:     6.0/10
Operational completeness:   7.5/10
Production readiness:       6.5/10
```

Головний висновок: **v4 вже добре описує, що повинно бути істинним, але недостатньо строго описує, хто, де і атомарно забезпечує цю істинність.**

---

# 1. CRITICAL — `fence_token` все ще не є справжнім fencing mechanism

Це найважливіша проблема.

У документі правильно написано:

```text
operation.fence_token == authoritative.fence_token
```

і правильно вказано, що перевірка має бути authoritative. 

Але цього недостатньо.

Сценарій:

```text
T0:
Agent A reads fence=4

T1:
Agent B reclaim
fence=5

T2:
Agent A checks fence=4
→ looks valid due to stale read/cache

T3:
A performs operation

T4:
B's fence=5 is current
```

Ще гірше:

```text
A checks fence
      ↓
scheduler/context switch
      ↓
B advances fence
      ↓
A performs operation
```

Тобто навіть:

```text
READ CURRENT FENCE
→ CHECK
→ ACT
```

має TOCTOU.

Ваш же документ прямо каже, що для consequential operations потрібна атомарність або `CHECK + VERSION + ACT`. 

Але **сама fence-архітектура не формалізує atomic enforcement point**.

### Що потрібно

Потрібна формальна primitive:

```text
AUTHORIZE_AND_EXECUTE(
    operation_id,
    task_id,
    fence_token,
    incarnation,
    expected_resource_version
)
```

або:

```text
CAS(
    resource_version=N,
    fence_token=K
)
→ EXECUTE
```

в межах **одного authoritative transaction**.

Інакше `fence_token` — просто metadata.

---

# 2. CRITICAL — немає справжнього atomic state transition protocol

Це ще фундаментальніше.

Наприклад:

```text
ACTIVE → REVIEW
```

описано дуже добре концептуально. 

Але не визначено:

```text
де знаходиться authoritative state
як він версіонується
як виконується CAS
як уникнути concurrent transition
```

Приклад race:

```text
Agent A:
ACTIVE → REVIEW

Master:
ACTIVE → RECLAIM_REQUIRED

A:
writes REVIEW

Master:
writes RECLAIMED
```

Хто переміг?

Документ це не формалізує.

Потрібно:

```yaml
state_version: 41
```

і:

```text
transition ACTIVE(version=41)
→ REVIEW(version=42)
```

з CAS:

```text
UPDATE state
WHERE task_id=T
AND state=ACTIVE
AND state_version=41
AND fence_token=7
AND incarnation=12
```

Без цього state machine є **описом**, але не distributed state machine.

---

# 3. CRITICAL — Task manifest не прив'язаний cryptographically до claim

Ви правильно забороняєте тихо змінювати acceptance criteria після старту. 

Але механізм доказу відсутній.

У claim зараз:

```yaml
task_id
agent_id
fence_token
incarnation
base_sha
...
```



Відсутнє:

```text
task_manifest_sha
task_contract_version
acceptance_digest
```

А тому маємо:

```text
T0:
task manifest = version 1

T1:
agent claims

T2:
manifest changes to version 2

T3:
agent submits evidence against version 1

T4:
reviewer reads version 2
```

Тепер неочевидно, **який contract був реально виконаний**.

### Потрібно

Наприклад:

```yaml
contract_sha: <SHA256>
contract_version: 7
```

Claim повинен бути:

```text
CLAIM =
task_id
+ contract_sha
+ base_sha
+ fence_token
+ incarnation
```

А кожен:

```text
TEST
REVIEW
APPROVAL
MERGE
DEPLOY
```

повинен бути прив'язаний до того самого contract identity.

---

# 4. CRITICAL — `agent_id` не є identity

Документ використовує:

```yaml
agent_id: agent-foo
role: slave
```

але не описує **як доведено, що саме agent-foo це підписав**.

Це security hole.

Якщо coordination record говорить:

```text
agent_id=agent-foo
fence=7
```

але будь-який процес може написати:

```text
agent_id=agent-foo
```

то agent identity — лише string.

Для production-grade моделі потрібно розділити:

```text
AGENT_ID
IDENTITY
AUTHENTICATION
AUTHORIZATION
CAPABILITY
```

Наприклад:

```yaml
agent_id: agent-foo
identity_key_id: key-123
credential_epoch: 9
capabilities:
  - CODE
  - TEST
signature: ...
```

Для сильнішої моделі:

```text
signed lease
signed transition
signed operation
```

Git підтримує signed push requests, які можуть бути перевірені на receiving side/hooks, але це лише один компонент identity model. ([Git][1])

---

# 5. CRITICAL — `ROLE` та `CAPABILITY` концептуально правильні, але capability не authenticated

Документ добре відділяє:

```text
ROLE != CAPABILITY
```



але:

```yaml
capabilities_required:
  - SECURITY
  - DEPLOY
```

ще не означає, що конкретний процес **має** ці capability.

Потрібно визначити:

```text
capability issuer
capability lifetime
capability scope
capability revocation
capability authentication
```

Інакше агент просто декларує:

```text
I AM DEPLOY
```

і policy каже:

```text
OK.
```

---

# 6. CRITICAL — ієрархія authority суперечлива

У вас:

```text
1. explicit current-session authorization
2. repository protection and CI policy
```

але нижче:

```text
Security policy має пріоритет над task convenience.
```



Це потенційно небезпечна суперечність.

Якщо human/session authorization стоїть **вище** за security policy, з'являється питання:

```text
Чи може explicit authorization дозволити заборонену security operation?
```

Очевидно, відповідь має бути:

```text
NO
```

Тому hierarchy має виглядати приблизно:

```text
1. immutable security constraints
2. repository protection
3. trusted authority
4. protocol state
5. task authorization
6. agent-local state
```

А не навпаки.

---

# 7. CRITICAL — self-review може бути дозволений самим workflow

Це дуже серйозна внутрішня суперечність.

У розділі independent review правильно сказано:

```text
IMPLEMENTER
↓
FRESH REVIEW CONTEXT
```



Але в `Agent completion procedure`:

```text
5. prepare review artifact
6. complete independent review
7. update handoff
```



Це можна прочитати як:

```text
agent implements
→ agent completes independent review
→ agent submits
```

Це порушує сам принцип independent review.

Треба жорстко визначити:

```text
AUTHOR != APPROVER
```

і для критичних tasks:

```text
AUTHOR
!=
REVIEWER
!=
DEPLOY AUTHORIZER
```

де policy може дозволити лише конкретні безпечні винятки.

---

# 8. HIGH — review identity недостатньо сильно прив'язана до конкретного artifact

Review має:

```text
Base
Head
Fence
Incarnation
Decision
Reviewer
```



Це добре.

Але треба додати:

```text
task_contract_sha
reviewer_identity
reviewer_capability
reviewed_tree_digest
required_checks_digest
toolchain_identity
CI evidence identity
```

Інакше:

```text
same HEAD
different environment
different dependency resolution
different generated artifacts
```

може формально виглядати як той самий review context.

---

# 9. HIGH — Proof-of-Progress все ще може бути підробленим

Ви дуже добре виправили стару помилку:

```text
HEAD unchanged => STUCK
```



Це правильний напрямок.

Але всі ці:

```text
TEST_PROGRESS
ANALYSIS_PROGRESS
ARTIFACT_PROGRESS
DEPENDENCY_PROGRESS
```

можуть бути **самозаявленими**.

Агент може написати:

```yaml
evidence_class:
  - ANALYSIS_PROGRESS
active_command: "complex analysis"
```

і фактично нічого не робити.

Потрібно розділити:

```text
SELF-REPORTED EVIDENCE
```

та:

```text
ATTESTED EVIDENCE
```

Наприклад:

```text
CI job result
process supervisor
trusted execution service
signed artifact
remote test result
scheduler state
```

Найсильніша модель:

```text
PROOF-OF-PROGRESS
=
agent claim
+
trusted observation
```

---

# 10. HIGH — lease semantics неповні

Є:

```text
lease_until_utc
last_heartbeat_utc
grace_minutes
```



але немає точного визначення:

```text
коли heartbeat renews lease
коли починається grace
хто встановлює time
чи може heartbeat after expiration renew lease
чи може stale heartbeat resurrect lease
```

Потрібно формально:

```text
renew allowed only if:
current_state == ACTIVE
AND current_fence == submitted_fence
AND current_incarnation == submitted_incarnation
AND now < lease_until + allowed_grace
```

і найважливіше:

```text
renewal itself must be atomic CAS
```

Інакше отримуємо:

```text
heartbeat-vs-reclaim race
```

яку документ декларує як сценарій, але не до кінця задає як protocol transaction.

---

# 11. HIGH — reclaim може втратити valid work або двічі змінити owner

Розділ reclaim хороший концептуально. 

Але не визначено:

```text
RECLAIM_ID
```

і не визначено idempotency.

Сценарій:

```text
Coordinator A:
reclaim task

Coordinator B:
reclaim same task

both see expired
both calculate fence=8
```

Що трапиться?

Потрібна distinct transition:

```text
current fence=7
expected fence=7
new fence=8
reclaim_operation_id=X
```

Другий reclaim повинен отримати:

```text
CONFLICT / STALE
```

а не незалежно "створити fence 8".

---

# 12. HIGH — `operation_id` поки що лише label, а не idempotency primitive

Документ вводить `operation_id`. Це правильний крок. 

Але не визначає:

```text
unique namespace
durability
replay semantics
expiration
same operation + same parameters
same operation + different parameters
```

Потрібно:

```text
operation_id
→ immutable operation record
```

і:

```text
same operation_id + same request
= same result

same operation_id + different request
= CONFLICT
```

Це особливо критично для:

```text
deploy
claim
reclaim
state transition
artifact publication
```

---

# 13. HIGH — merge queue має race у самому queue state

Ви правильно вводите candidate metadata:

```text
tested_base_sha
candidate_head_sha
queue_position
ci_run_id
result
```



але немає:

```text
queue_version
queue_epoch
candidate_generation
atomic dequeue/admit
```

Два coordinator-и можуть побачити:

```text
candidate #4 next
```

і обидва почати integration.

Потрібен:

```text
queue CAS
```

або:

```text
single-writer coordinator
```

або consensus-backed queue.

---

# 14. HIGH — fairness / starvation не формалізовані

Merge queue може бути technically correct, але starvation-prone.

Наприклад:

```text
A continuously changes
B never gets integrated
```

Відсутні:

```text
fairness policy
priority policy
aging
maximum queue residency
cancellation semantics
starvation detection
```

Для висококонкурентної системи це вже operational correctness, а не косметика.

---

# 15. HIGH — stale CI callback захищений концептуально, але не атомарно

В документі:

```text
callback
→ verify task_id
→ source_sha
→ base_sha
→ fence_token
→ incarnation
→ operation_id
```



Це дуже добре.

Але далі:

```text
VERIFY CURRENT AUTHORITATIVE STATE
```

і потім update state.

Знову:

```text
CHECK
→ callback applies
```

має TOCTOU.

Потрібно:

```text
APPLY_CALLBACK_IF(
  task_id,
  operation_id,
  fence_token,
  incarnation,
  source_sha,
  expected_state_version
)
```

однією authoritative transaction.

---

# 16. HIGH — `DONE` та deployment semantics мають неідеальну state model

У вас основний шлях:

```text
APPROVED
→ MERGE_QUEUED
→ INTEGRATED
→ DONE
```



але deployment flow:

```text
INTEGRATED
→ DEPLOY_QUEUED
→ DEPLOYED
→ DONE
```

Проблема:

```text
DONE
```

має різне semantic meaning для:

```text
library/code task
production deployment task
```

Краще розділити:

```text
CODE_COMPLETE
INTEGRATED
RELEASE_READY
DEPLOYED
VERIFIED
CLOSED
```

або чітко визначити:

```text
DONE = task contract complete
```

і deployment — лише окремий release lifecycle.

---

# 17. HIGH — GC має race з delayed events

Документ правильно каже:

```text
GC WHEN SAFE
```



але "safe" математично не визначено.

Сценарій:

```text
task DONE
GC removes claim/review ref
↓
late CI callback arrives
↓
callback references deleted operation
```

Або:

```text
audit consumer delayed
↓
record deleted
```

Потрібен:

```text
retention horizon
late-event quarantine
tombstone
operation registry
```

Наприклад:

```text
ACTIVE
→ TERMINAL
→ TOMBSTONE
→ RETAIN
→ GC
```

---

# 18. MEDIUM/HIGH — Git refs ≠ generalized transactional database

Це фундаментальне архітектурне обмеження.

Git справді підтримує conditional ref updates і atomic transactions, але це гарантує атомарність **ref updates**, а не довільну multi-resource distributed transaction. `git update-ref` може умовно оновлювати refs і виконувати transaction, однак читачі можуть спостерігати підмножину змін між різними refs. ([Git][2])

Тому не можна моделювати:

```text
task manifest
+
claim
+
review
+
queue
+
deployment
```

як один atomic object лише тому, що все лежить у Git.

Потрібно чітко визначити:

```text
Git Atomicity Domain
```

проти:

```text
Protocol Transaction Domain
```

---

# 19. MEDIUM — Worktree isolation має прихований shared config problem

Це важлива тонкість.

Git worktrees ізольовують working trees, але частина repository configuration за замовчуванням **shared між worktrees**; Git має `extensions.worktreeConfig` саме для випадків, коли потрібна worktree-specific configuration. ([Git][3])

Тобто:

```text
worktree isolation
```

не означає:

```text
complete Git configuration isolation
```

Це потрібно прямо зафіксувати у v4.

---

# 20. HIGH — local hooks правильно названі defense-in-depth, але bypass path треба formalize

Це місце v4 хороше:

```text
local hook != security boundary
```



І це відповідає Git documentation: effective policy enforcement має виконуватися на remote/server side або через CI, а локальні hooks можуть бути обійдені. ([Git][4])

Але треба додати explicit threat:

```text
agent can replace/delete local hook
agent can use --no-verify
agent can modify local Git config
agent can bypass local wrappers
```

Тому security boundary:

```text
REMOTE TRUSTED ENFORCEMENT
```

має бути normative, а не просто recommended.

---

# 21. HIGH — branch protection не завжди означає “ніхто не bypass”

Це особливо важливо для універсального протоколу.

Наприклад, платформи можуть мати administrator/custom-role bypass capabilities. У GitHub protection rules є explicit bypass semantics; їх можна окремо налаштовувати, а rulesets можуть мати bypass actors. ([GitHub Docs][5])

Тому v4 повинен мати:

```text
PROTECTED
!=
IMMUTABLE
```

і:

```text
BYPASS AUTHORITY
must be explicit
audited
minimal
```

Особливо для `master`.

---

# 22. HIGH — security policy не захищена від “privileged master”

У вас:

```text
master may:
modify protected protocol files
perform emergency recovery
authorize deployment
```



Це нормально як рольова модель.

Але в adversarial model:

```text
malicious master
compromised master credential
buggy master automation
```

фактично знищують багато гарантій.

Отже система не є:

```text
Byzantine tolerant
```

і документ це визнає. 

Але треба сформулювати **trust root**:

```text
Which components are trusted?
Which component is not allowed to bypass?
Who can revoke master?
Can two-person authorization override master?
```

---

# 23. HIGH — sandbox недостатньо конкретний щодо kernel/container escape

Перелік хороший:

```text
restricted network
restricted filesystem
CPU quota
memory quota
process limit
timeout
```



Але security boundary повинна визначити:

```text
container runtime trust
host kernel trust
rootless requirement
seccomp
capabilities drop
no-new-privileges
PID namespace
network namespace
mount namespace
secret injection
egress allowlist
```

І особливо:

```text
host docker socket
```

вже справедливо заборонений. 

Але потрібен explicit rule:

```text
container escape = trusted-boundary compromise
```

---

# 24. MEDIUM/HIGH — runtime verification занадто generic

Правильно, що ви відокремлюєте:

```text
HEALTH
BUSINESS CORRECTNESS
```



Але `HEALTHY` повинен мати precise semantics.

Наприклад:

```text
process responds
```

ще не означає:

```text
correct service version
correct database schema
correct config
correct dependency connectivity
```

Рекомендовано:

```yaml
runtime_verification:
  deployment_id: ...
  source_sha: ...
  environment: ...
  checks:
    - name: health
      result: PASS
    - name: smoke
      result: PASS
    - name: version_identity
      result: PASS
```

---

# 25. MEDIUM — rollback теж не завжди trivially safe

Ви правильно вимагаєте exact rollback target. 

Але:

```text
code rollback
```

не дорівнює:

```text
database rollback
```

Іноді:

```text
schema migrated
code rollback
→ old code incompatible
```

Тому deployment contract має мати:

```text
application rollback
schema rollback
data rollback
configuration rollback
dependency rollback
```

або explicit:

```text
rollback impossible
```

з forward-fix plan.

---

# 26. MEDIUM — artifact integrity не дорівнює artifact provenance

`SHA-256` digest — корисно. 

Але:

```text
digest proves identity
```

не:

```text
artifact was built by trusted builder
```

Потрібно за можливості:

```text
builder identity
build attestation
source provenance
dependency provenance
signature
```

Тобто:

```text
integrity
+
provenance
+
authorization
```

---

# 27. MEDIUM — dependency reproducibility все ще не повна

Документ вимагає:

```text
LOCKFILES
TOOLCHAIN_VERSION
DECLARED_CONFIGURATION
```



Але reproducibility може залежати ще від:

```text
OS image
compiler
CPU architecture
environment variables
locale
timezone
networked package content
generated timestamps
filesystem ordering
external service versions
```

Для critical builds краще:

```text
immutable builder image digest
```

а не лише:

```text
TOOLCHAIN_VERSION
```

---

# 28. MEDIUM — `Semantic Base Validation` не повинна виглядати більш формальною, ніж вона є

Цей розділ вже значно кращий за попередню версію:

```text
HASH == EVIDENCE
HASH != COMPLETE SEMANTIC PROOF
```



Це правильне формулювання.

Але я б посилив його ще:

```text
AST/API analysis
=
risk reduction
not
semantic proof
```

Бо інакше майбутня implementation team може фактично перетворити heuristic на security gate.

---

# 29. MEDIUM — `dependency cone` не визначений

В review matrix сказано:

```text
unrelated change outside dependency cone
→ potentially valid
```



Але:

```text
dependency cone
```

не має formal definition.

У складних системах він може включати:

```text
runtime reflection
configuration
DI
generated code
database schema
network contracts
feature flags
```

Потрібна мінімум policy:

```text
DEPENDENCY_GRAPH_SOURCE
DEPENDENCY_GRAPH_VERSION
UNKNOWN_DEPENDENCY = INVALIDATE REVIEW
```

---

# 30. MEDIUM — path ownership не враховує semantic resources

Файли можуть не перетинатися, але resource shared:

```text
foo/config
bar/runtime
```

обидва можуть змінювати:

```text
same database behavior
same API
same cache
same environment
```

Тому треба два різні lock classes:

```text
PATH LOCK
RESOURCE LOCK
```

---

# 31. MEDIUM — database migration model надто спрощена

Опис:

```text
destructive migration → serialized
```

правильний, але production DB systems потребують ще:

```text
migration ordering
transaction semantics
locking behavior
online migration capability
expand/contract
backfill batches
resume semantics
schema compatibility windows
```

Особливо:

```text
migration_id
```

має бути global monotonic schema state, а не просто task metadata.

---

# 32. MEDIUM — emergency procedure створює небезпечне “review when practical”

Це:

```text
REVIEW WHEN PRACTICAL
```



занадто розмите для production security protocol.

Потрібні два режими:

```text
EMERGENCY_BYPASS
EMERGENCY_REVIEW_REQUIRED
```

і обов'язково:

```text
who authorized bypass
why
what gates were skipped
expiry
post-incident review
```

Emergency bypass без TTL часто перетворюється на permanent bypass.

---

# 33. LOW/MEDIUM — nomenclature `Slave`

Для технічного протоколу я б рекомендував перейти на:

```text
MASTER
WORKER
```

або:

```text
COORDINATOR
AGENT
```

Це не security defect, але для довгоживучої universal specification краще:

```text
ROLE=coordinator
ROLE=worker
```

Особливо якщо v4 має стати формальним стандартом.

---

# 34. Дуже важливе: що в v4 вже зроблено ПРАВИЛЬНО

Тут red-team також повинен бути чесним.

### 34.1. Правильна відмова від “Git = distributed lock manager”

Це одна з найсильніших змін. 

### 34.2. Правильний `UNKNOWN != SUCCESS`

Це дуже важливий operational invariant. 

### 34.3. Правильний поділ Safety / Liveness



Це вже мислення distributed-systems рівня.

### 34.4. Правильне усвідомлення stale callbacks



### 34.5. Правильне посилення heartbeat model

Відмова від простого:

```text
HEAD changed
```

на користь кількох evidence classes — суттєве покращення. 

### 34.6. Correct defense-in-depth для Git hooks

Remote enforcement як справжня межа — технічно правильна позиція. Git documentation також відрізняє client-side hooks від remote/server-side policy enforcement. ([Git][4])

### 34.7. Merge queue conceptually правильний

Сучасні системи merge queue саме для того й існують, щоб повторно перевіряти PR проти актуального target branch та queued changes. ([GitHub Docs][6])

---

# 35. Найнебезпечніший composite attack

Ось сценарій, який я б обов'язково додав як formal adversarial test:

```text
Agent A owns:
task=T
contract=7
fence=14
incarnation=3

↓

Network partition

↓

Coordinator B:
reclaim T
fence=15
incarnation=4

↓

A resumes

↓

A has stale:
contract=7
fence=14
review=PASS
CI=PASS

↓

A sends delayed callback

↓

Coordinator checks:
task_id = T
fence = 14

↓

TOCTOU / stale read

↓

callback mutates state

OR

A pushes new commit to task branch

OR

A deploys artifact

OR

A renews lease

```

Це одна атака, але вона тестує одразу:

```text
fence
incarnation
lease
review
CI
branch ownership
deployment
callbacks
CAS
```

Поточний v4 описує всі ці елементи, але **не має єдиного формального atomic transaction primitive, який закриває весь сценарій**.

---

# 36. Якої архітектурної зміни насправді бракує v4

На мою думку, наступна ітерація вже не повинна просто додавати ще 20 правил.

Потрібно додати **четвертий fundamental layer**:

```text
POLICY
+
STATE MACHINE
+
ENFORCEMENT
+
TRANSACTION MODEL
```

Зараз є:

```text
POLICY       ✅
STATE        ✅
ENFORCEMENT  частково ✅
TRANSACTION  ❌
```

---

# 37. Що я б ввів у v5

Кістяк:

```text
1. Canonical State Object
2. state_version
3. contract_sha
4. fence_token
5. incarnation
6. operation_id
7. authenticated agent identity
8. capability token
9. atomic transition primitive
10. event/tombstone retention
11. trusted evidence vs self-reported evidence
12. explicit trust-root model
```

І одна універсальна примітивна операція:

```text
conditional_transition(
    resource,
    expected_version,
    expected_fence,
    expected_incarnation,
    expected_contract_sha,
    operation_id,
    action
)
```

Результат:

```text
COMMITTED
CONFLICT
STALE
REJECTED
UNKNOWN
```

Це значно важливіше, ніж додавання ще одного виду heartbeat.

---

# 38. Найважливіший structural redesign

Я б зробив canonical object приблизно таким:

```yaml
schema_version: "5.0"

task_id: TASK-001

state:
  value: ACTIVE
  version: 42

contract:
  version: 7
  sha256: <HASH>

ownership:
  agent_id: agent-foo
  identity_key_id: key-123
  fence_token: 15
  incarnation: 4

lease:
  issued_utc: <UTC>
  expires_utc: <UTC>

source:
  base_sha: <SHA>
  head_sha: <SHA>

operation:
  current_id: op-foo-001

verification:
  ci_run_id: <ID>
  result: PASS

review:
  artifact: <REF>
  reviewer_identity: agent-bar
  reviewed_head_sha: <SHA>
  status: PASS
```

Тоді кожна operation повинна бути функцією:

```text
CURRENT_STATE
+
EXPECTED_STATE
+
ACTOR
+
CAPABILITY
+
OPERATION_ID
+
EVIDENCE
→
NEXT_STATE
```

Це вже справжня protocol machine.

---

# 39. Остаточний verdict

**v4 я б назвав дуже сильним architecture draft, але ще не production-grade protocol.**

Головні blockers до `APPROVED`:

```text
P0
atomic state transitions

P0
true fence enforcement

P0
contract hash binding

P0
authenticated agent identity

P0
no self-review

P0
atomic stale-callback rejection

P1
lease/reclaim transaction semantics

P1
operation_id idempotency semantics

P1
merge queue serialization/fairness

P1
GC/tombstone protocol

P1
trusted-vs-self-reported evidence

P1
explicit trust-root / bypass model
```

Ваш v4 уже правильно рухається від:

```text
"інструкція для AI-агентів"
```

до:

```text
"distributed coordination protocol"
```

Але наступний стрибок має бути не в кількості правил, а в **формалізації canonical state + CAS/transaction semantics + authenticated authority**.

Git дійсно дає корисні atomic conditional ref primitives, а сучасні Git-платформи мають branch protection, required checks і merge queues, але ці механізми не замінюють вашу власну transaction semantics для coordination state. ([Git][2])

Мій red-team вердикт: **REJECT → REVISE → RED-TEAM AGAIN**. Найбільша цінність v4 уже є; тепер його треба довести від дуже хорошої policy specification до формально визначеного протоколу з atomic transition semantics.

[1]: https://git-scm.com/docs/git-push?utm_source=chatgpt.com "Git - git-push Documentation"
[2]: https://git-scm.com/docs/git-update-ref/2.1.4.html?utm_source=chatgpt.com "Git - git-update-ref Documentation"
[3]: https://git-scm.com/docs/git-worktree?utm_source=chatgpt.com "Git - git-worktree Documentation"
[4]: https://git-scm.com/docs/githooks?utm_source=chatgpt.com "Git - githooks Documentation"
[5]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository?utm_source=chatgpt.com "Creating rulesets for a repository - GitHub Docs"
[6]: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches?utm_source=chatgpt.com "About protected branches - GitHub Docs"
