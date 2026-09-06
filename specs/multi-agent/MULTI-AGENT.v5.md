# MULTI-AGENT.md — Формальний протокол координації та інженерії мультиагентних систем

> **Версія:** 5.0
>
> **Статус:** normative protocol specification / production-grade draft
>
> **Мова:** українська; назви команд, параметрів, станів, полів, типів та machine-readable identifiers — англійською
>
> **Область застосування:** один Git-репозиторій, багато автономних агентів, люди, CI/CD, automation та privileged controllers
>
> **Основна мета:** формально визначена безпечна concurrent execution з atomic state transitions, authenticated authority, fencing, deterministic verification, auditable integration, controlled deployment та recoverable failure semantics

---

# 0. Executive summary

Версія 5 є еволюцією від policy-centric моделі до **formally specified protocol**.

У центрі v5 знаходиться не Git branch, не Markdown-файл і не heartbeat, а:

```text
CANONICAL STATE
    +
AUTHENTICATED ACTOR
    +
CAPABILITY
    +
EXPECTED VERSION/FENCE
    +
OPERATION ID
    +
VERIFIABLE EVIDENCE
    ↓
ATOMIC STATE TRANSITION
    ↓
NEW CANONICAL STATE
```

Основна властивість:

```text
A consequential operation is valid
iff
it is authorized,
its preconditions match the authoritative state,
its actor is authenticated,
its capability permits the operation,
its fence/incarnation is current,
its operation_id is acceptable,
and its transition commits atomically.
```

v5 розділяє:

```text
POLICY
STATE
AUTHORITY
TRANSACTION
EVIDENCE
ENFORCEMENT
RECOVERY
```

Це є фундаментальною зміною порівняно з моделлю, де coordination state описувався переважно через Git refs і процедурні правила.

---

# 1. Design goals

Протокол повинен забезпечувати:

```text
SAFETY
LIVENESS
AUDITABILITY
REPRODUCIBILITY
RECOVERABILITY
LEAST PRIVILEGE
CONCURRENCY
FAIL-CLOSED DEFAULTS
```

## 1.1. Safety

При коректному trusted infrastructure:

```text
no simultaneous authoritative ownership
no stale owner mutation
no unauthorized transition
no stale callback mutation
no unreviewed protected integration
no unauthorized deployment
no silent state overwrite
```

## 1.2. Liveness

За відсутності нескінченних infrastructure failures:

```text
eligible tasks can eventually be claimed
expired ownership can eventually be reclaimed
queued work can eventually progress
terminal tasks can eventually be finalized
```

Safety має пріоритет над liveness.

При конфлікті:

```text
SAFE STOP
```

кращий за небезпечне продовження.

---

# 2. Scope and trust boundaries

Протокол не робить автоматично trusted:

```text
agent
model
local filesystem
local Git hooks
local clock
local CI worker
external API
deployment target
runtime health
```

Мінімально trusted infrastructure для повної моделі:

```text
AUTHORITATIVE STATE STORE
AUTHENTICATION SERVICE
AUTHORIZATION / CAPABILITY SERVICE
ENFORCEMENT POINT
```

Це може бути реалізовано на базі:

```text
Git refs
database
coordination service
CI system
deployment controller
hybrid architecture
```

Git є допустимим durable substrate, але не повинен автоматично трактуватися як generalized transactional database.

---

# 3. Threat model

За замовчуванням протокол враховує:

```text
PROCESS CRASH
RESTART
MESSAGE LOSS
DUPLICATE MESSAGE
TIMEOUT
DELAYED MESSAGE
NETWORK PARTITION
STALE READ
STALE CALLBACK
CONCURRENT CLAIM
CONCURRENT RECLAIM
RACE CONDITION
TOCTOU
BUGGY AGENT
MISBEHAVING AGENT
COMPROMISED LOCAL ENVIRONMENT
PARTIAL DEPLOYMENT
```

Протокол **не гарантує Byzantine Fault Tolerance**, якщо compromised trusted infrastructure може довільно підмінити:

```text
identity
state
authorization
CI evidence
deployment state
```

Для Byzantine resistance потрібна окрема модель quorum/consensus/trusted execution.

---

# 4. Core terminology

```text
TASK
CONTRACT
ACTOR
AGENT
AUTHORITY
CAPABILITY
CLAIM
LEASE
FENCE
INCARNATION
STATE_VERSION
OPERATION
EVIDENCE
ATTESTATION
TRANSITION
EVENT
PROJECTION
ARTIFACT
REVIEW
QUEUE
DEPLOYMENT
```

---

# 5. Canonical state

## 5.1. Основний принцип

У кожної task існує один authoritative canonical state:

```text
S(T)
```

Будь-яка consequential operation читає canonical state, перевіряє preconditions і створює новий state тільки через atomic transition.

## 5.2. Canonical state schema

Рекомендований формат:

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
  actor_id: agent-foo
  identity_key_id: key-123
  fence_token: 15
  incarnation: 4

lease:
  issued_utc: <UTC>
  expires_utc: <UTC>

source:
  base_sha: <SHA>
  head_sha: <SHA>

review:
  status: NOT_REQUIRED
  reviewed_head_sha: null
  artifact_ref: null

verification:
  status: UNKNOWN
  evidence_refs: []

operation:
  current_id: op-foo-001

queue:
  name: null
  position: null
  generation: null

deployment:
  status: NOT_DEPLOYED
  deployment_id: null
  artifact_digest: null

terminal:
  result: null
  closed_utc: null
```

## 5.3. Canonical state invariants

```text
task_id is immutable

state.version is monotonic

contract.version is monotonic

contract.sha256 identifies exact contract

fence_token is monotonic

incarnation is monotonic per task ownership lineage

operation_id is unique within its authority domain

state.value must be a valid protocol state

state transition must be atomic
```

---

# 6. State version

`state.version` є optimistic concurrency control token.

Перед transition:

```text
READ state.version = N
```

Transition має вказати:

```text
expected_state_version = N
```

Commit дозволено лише якщо authoritative version все ще `N`.

Успішний transition:

```text
N → N+1
```

При mismatch:

```text
CONFLICT
```

або:

```text
STALE
```

але ніколи:

```text
overwrite
```

---

# 7. Contract identity

Acceptance criteria та task intent є частиною immutable contract identity.

Обов'язкові поля:

```yaml
contract:
  version: 7
  sha256: <HASH>
```

Будь-які:

```text
TEST
REVIEW
APPROVAL
MERGE
DEPLOY
```

повинні посилатися на exact:

```text
contract.version
contract.sha256
```

## 7.1. Contract mutation

Після початку work:

```text
contract.sha256 MUST NOT silently change
```

Матеріальна зміна:

```text
OLD CONTRACT
→ BLOCKED/CANCELLED

NEW CONTRACT
→ NEW VERSIONED TASK
```

або explicit immutable contract revision.

---

# 8. Authenticated actor model

`actor_id` сам по собі не є identity proof.

Мінімальна модель:

```yaml
actor:
  actor_id: agent-foo
  identity_key_id: key-123
  authentication_method: public_key
  credential_epoch: 9
```

Потрібно розділяти:

```text
IDENTIFIER
IDENTITY
AUTHENTICATION
AUTHORIZATION
CAPABILITY
ROLE
```

## 8.1. Actor identity

Actor повинен мати authenticated identity через trusted mechanism:

```text
signed credential
mTLS identity
OIDC workload identity
SSH key
platform-native workload identity
```

Конкретний mechanism є deployment-specific.

## 8.2. Credential epoch

Для revocation:

```text
credential_epoch
```

може бути monotonic.

Після compromise:

```text
credential_epoch += 1
```

старі credentials invalid.

---

# 9. Capability model

Capabilities є scoped authorization grants.

Приклад:

```yaml
capability:
  id: cap-foo-001
  actor_id: agent-foo
  capability: DEPLOY
  scope:
    environment: example
    task_id: TASK-001
  issued_utc: <UTC>
  expires_utc: <UTC>
  credential_epoch: 9
```

Capability повинна бути:

```text
authenticated
scoped
time-bounded where appropriate
revocable
auditable
```

## 9.1. Least privilege

Actor отримує тільки capabilities, потрібні task:

```text
ROLE != CAPABILITY
```

Role описує protocol role.

Capability описує конкретно дозволену operation.

---

# 10. Authority hierarchy

Canonical hierarchy:

```text
1. immutable security constraints
2. trusted enforcement policy
3. authenticated authority
4. authoritative canonical state
5. approved contract/specification
6. task-local evidence
7. local state
8. agent assumptions
```

Жоден human/agent instruction не може override immutable security constraints без окремого protocol-defined emergency mechanism.

---

# 11. Operation model

Кожна consequential operation має:

```yaml
operation_id: op-foo-001
task_id: TASK-001

actor_id: agent-foo
identity_key_id: key-123

action: CLAIM

expected_state_version: 41
expected_fence_token: 14
expected_incarnation: 3
expected_contract_sha: <HASH>

requested_at_utc: <UTC>
```

## 11.1. Operation identity

Правило:

```text
same operation_id
+
same request identity
=
same logical operation
```

Повторення повинно бути idempotent.

Але:

```text
same operation_id
+
different request
=
CONFLICT
```

## 11.2. Operation lifecycle

```text
RECEIVED
→ VALIDATING
→ COMMITTED
```

або:

```text
RECEIVED
→ REJECTED
```

або:

```text
RECEIVED
→ CONFLICT
```

або:

```text
RECEIVED
→ UNKNOWN
```

`UNKNOWN` означає, що outcome не встановлено і потребує reconciliation.

---

# 12. Atomic transition primitive

Це центральна primitive v5.

Концептуально:

```text
conditional_transition(
    resource = TASK-001,
    expected_state_version = 41,
    expected_fence_token = 14,
    expected_incarnation = 3,
    expected_contract_sha = <HASH>,
    operation_id = op-foo-001,
    actor = agent-foo,
    capability = CODE,
    transition = ACTIVE → REVIEW,
    evidence = [...]
)
```

Atomic operation повинна виконати:

```text
AUTHENTICATE
→ AUTHORIZE
→ READ CURRENT STATE
→ VERIFY PRECONDITIONS
→ VERIFY OPERATION
→ VERIFY FENCE
→ VERIFY CONTRACT
→ VERIFY EVIDENCE
→ COMMIT NEXT STATE
→ APPEND DURABLE EVENT
```

або нічого.

---

# 13. Transition transaction semantics

## 13.1. ACID-like requirement

Для canonical state transition потрібна принаймні:

```text
ATOMICITY
CONSISTENCY
DURABILITY
```

Isolation semantics залежать від backend, але operation не може дозволяти lost update.

## 13.2. Atomicity boundary

Atomicity boundary повинна включати щонайменше:

```text
canonical state mutation
state version increment
operation result
durable transition event
```

Якщо backend не може атомарно змінити всі ці компоненти:

```text
use append-only event + deterministic projection
```

або trusted transactional coordinator.

---

# 14. Event model

Canonical state може бути materialized projection з immutable events.

Рекомендований event:

```yaml
event_id: evt-foo-001
event_seq: 102

task_id: TASK-001

operation_id: op-foo-001

actor_id: agent-foo
identity_key_id: key-123

from_state_version: 41
to_state_version: 42

from_state: ACTIVE
to_state: REVIEW

fence_token: 14
incarnation: 3

contract_sha256: <HASH>

occurred_utc: <UTC>

evidence:
  - ref: test-run-123
```

## 14.1. Event ordering

Для одного task:

```text
event_seq
```

повинен бути monotonic.

Gap може бути:

```text
RECONCILIATION_REQUIRED
```

---

# 15. Event vs projection

У системі слід розділити:

```text
EVENT LOG
```

та:

```text
CANONICAL PROJECTION
```

Projection можна rebuild:

```text
EVENTS
→ REDUCE
→ CANONICAL STATE
```

Це дозволяє recovery після corruption projection.

---

# 16. Transition function

Кожен allowed transition визначається:

```text
F(
  current_state,
  operation,
  actor,
  capability,
  evidence
)
→
next_state
```

Transition існує тільки якщо:

```text
preconditions == true
authorization == true
fence == current
contract == current
state_version == expected
```

Інакше:

```text
REJECT
```

---

# 17. Formal transition contract

Для кожного transition документується:

```text
TRANSITION_ID
SOURCE_STATE
TARGET_STATE

REQUIRED_CAPABILITIES
REQUIRED_EVIDENCE

EXPECTED_VERSION_RULE
FENCE_RULE
CONTRACT_RULE

SIDE_EFFECTS
ATOMICITY_BOUNDARY

FAILURE_RESULTS
RECOVERY_PROCEDURE
```

Приклад:

```text
TRANSITION_ID=ACTIVE_TO_REVIEW

SOURCE_STATE=ACTIVE
TARGET_STATE=REVIEW

CAPABILITY=CODE

REQUIRES:
  current_owner
  current_fence
  current_incarnation
  current_contract
  required_tests_pass
  clean_expected_diff

POST:
  state.version += 1
  review.requested = true
```

---

# 18. Ownership as a state machine

Ownership більше не є просто ref.

Вона має:

```text
UNOWNED
CLAIMED
ACTIVE
EXPIRED
RECLAIMING
RECLAIMED
RELEASED
```

Task state та ownership state не треба змішувати.

Наприклад:

```yaml
task_state: REVIEW
ownership_state: RELEASED
```

це нормально.

Reviewer може не бути task owner.

---

# 19. Claim transaction

Claim:

```text
TODO
```

→ ownership created atomically.

Preconditions:

```text
task.state == TODO
dependencies satisfied
exclusive resources free
required capability present
```

Transaction:

```text
state_version=N
ownership=none

→ create ownership
→ fence_token=F
→ incarnation=I
→ state.version=N+1
```

## 19.1. Claim collision

Два actors:

```text
A expected version N
B expected version N
```

Лише одна transaction може commit.

Winner:

```text
COMMITTED
```

Loser:

```text
CONFLICT
→ reread
```

---

# 20. Fence token

`fence_token` є ownership epoch.

Правила:

```text
monotonic
never reused
never decremented
authoritative
validated at consequential boundaries
```

## 20.1. Fence semantics

Old owner:

```text
fence=14
```

New owner:

```text
fence=15
```

Any operation:

```text
fence=14
```

must be rejected if current canonical state is:

```text
fence=15
```

---

# 21. Why a fence is not enough

Навіть:

```text
READ fence
CHECK fence
ACT
```

не є atomic.

Між check та act може відбутися:

```text
RECLAIM
```

Тому current fence must participate in:

```text
CAS
transaction
conditional update
lease service primitive
```

а не тільки in-memory check.

---

# 22. Incarnation

`incarnation` ідентифікує конкретну ownership epoch/process lineage.

При reclaim:

```text
incarnation += 1
fence_token += 1
```

Це корисно для:

```text
agent restart
stale worker
late callback
delayed queue job
duplicate operation
```

---

# 23. Lease

Lease:

```yaml
issued_utc: <UTC>
expires_utc: <UTC>
```

Необхідні ще:

```text
fence_token
incarnation
```

Lease renewal:

```text
CAS expected fence
CAS expected incarnation
CAS expected state version
```

Просте timestamp rewrite не є достатнім.

---

# 24. Heartbeat

Heartbeat є liveness signal.

```text
heartbeat != proof of useful work
```

Допустимі evidence classes:

```text
CODE_PROGRESS
TEST_PROGRESS
CI_PROGRESS
ANALYSIS_PROGRESS
ARTIFACT_PROGRESS
DEPENDENCY_PROGRESS
COORDINATION_PROGRESS
```

Але кожна evidence повинна мати classification:

```text
SELF_REPORTED
OBSERVED
ATTESTED
```

## 24.1. Trusted progress

Найсильніше:

```text
CI result
process supervisor
build service
signed artifact
trusted execution record
```

Self-reported progress не повинен мати той самий security weight, що й independently observed evidence.

---

# 25. Reclaim

Reclaim є atomic ownership transition:

```text
ACTIVE owner=A fence=14 incarnation=3
```

→

```text
owner=B fence=15 incarnation=4
```

тільки за valid preconditions.

## 25.1. Reclaim preconditions

Наприклад:

```text
lease expired
AND
grace exceeded
AND
no valid active evidence
AND
no protected operation running
```

точні thresholds — configuration policy.

## 25.2. Concurrent reclaim

Два reclaimers:

```text
R1
R2
```

повинні працювати через CAS/state version.

Тільки одна transaction може advance ownership epoch у конкретній state version.

---

# 26. Stale actor rule

Після зміни fence/incarnation:

```text
old actor = STALE
```

Його локальна:

```text
clock
branch
memory
heartbeat
review
CI
```

не дають йому права на consequential operation.

---

# 27. Authentication of state transitions

Для critical deployments бажано мати signed transition request:

```yaml
operation_id: op-foo-001
actor_id: agent-foo
action: DEPLOY
payload_hash: <HASH>
signature: <SIGNATURE>
```

Verifier перевіряє:

```text
identity
credential epoch
signature
capability
request hash
current state
fence
```

---

# 28. Evidence model

Evidence має бути object, а не текстова фраза.

```yaml
evidence_id: ev-foo-001

type: TEST_RESULT

subject:
  task_id: TASK-001
  source_sha: <SHA>

producer:
  actor_id: agent-foo
  identity_key_id: key-123

trust_level: ATTESTED

created_utc: <UTC>

content_hash: <HASH>

result: PASS
```

---

# 29. Evidence trust levels

```text
UNVERIFIED
SELF_REPORTED
OBSERVED
ATTESTED
TRUSTED
```

Policy може встановлювати мінімальний trust level.

Наприклад:

```text
CODE_COMPLETE
requires OBSERVED

DEPLOY
requires TRUSTED

CRITICAL_SECURITY_APPROVAL
requires ATTESTED or TRUSTED
```

---

# 30. Verification result binding

CI result повинен бути прив'язаний до:

```text
task_id
contract_sha
source_sha
toolchain identity
execution environment
operation/CI id
```

Ніколи не вважати:

```text
CI=PASS
```

без identity context.

---

# 31. Review as typed transition

Review:

```text
NOT_REVIEWED
→ REVIEWED
```

але approval має бути окремою authorization result.

Review artifact:

```yaml
review_id: rev-foo-001
task_id: TASK-001

reviewer:
  actor_id: agent-bar
  identity_key_id: key-456

contract_sha256: <HASH>
base_sha: <SHA>
head_sha: <SHA>

decision: PASS

scope:
  correctness: PASS
  concurrency: PASS
  security: PASS
  data_integrity: PASS
  performance: PASS

evidence_refs:
  - ev-foo-001
```

---

# 32. No self-approval

Базове правило:

```text
AUTHOR != REVIEWER
```

Для approval:

```text
IMPLEMENTER != APPROVER
```

Для critical operations:

```text
IMPLEMENTER
!=
REVIEWER
!=
DEPLOY_AUTHORIZER
```

Винятки повинні бути explicit policy, а не implicit convenience.

---

# 33. Review invalidation

Approval valid only for exact review scope.

Review scope identity:

```text
contract_sha
base_sha
head_sha
relevant dependency state
required evidence set
```

Якщо змінився critical scope:

```text
REVIEW = INVALID
```

---

# 34. Semantic validation

AST/API/schema hashes корисні як evidence, але:

```text
HASH != semantic proof
```

Вони лише зменшують uncertainty.

Якщо dependency graph cannot be established reliably:

```text
REVIEW = INVALIDATED
```

а не:

```text
REVIEW = VALID
```

---

# 35. Dependency graph

Semantic review може залежати від:

```text
imports
public APIs
schema
configuration
feature flags
generated code
runtime reflection
external contracts
```

Потрібно мати:

```text
dependency_graph_version
dependency_graph_source
```

Unknown dependency:

```text
CONSERVATIVE INVALIDATION
```

---

# 36. Merge queue as state machine

Merge queue має canonical queue state:

```yaml
queue_id: merge-foo
version: 17
generation: 5

items:
  - task_id: TASK-001
    head_sha: <SHA>
    expected_base_sha: <SHA>
    status: QUEUED
```

Queue mutation є CAS operation.

---

# 37. Merge candidate

Candidate:

```yaml
candidate_id: cand-foo-001

task_id: TASK-001
queue_id: merge-foo

tested_base_sha: <SHA>
candidate_head_sha: <SHA>

queue_generation: 5

ci_run_id: ci-123
result: PASS
```

Candidate valid only for exact identity.

---

# 38. Queue race

Два queue workers не повинні одночасно admit one item.

Mechanism:

```text
queue version CAS
```

або single-writer coordinator.

`SELECT` без reservation/commit є недостатнім.

---

# 39. Queue invalidation

Якщо integration base змінився:

```text
candidate becomes STALE
```

потрібна:

```text
REVALIDATION
```

Не обов'язково скасовувати всю queue.

---

# 40. Fairness

Queue policy повинна визначити:

```text
priority
aging
maximum queue age
starvation detection
manual override
cancellation
```

Priority override повинна бути audit-recorded.

---

# 41. Git role

Git у v5 є:

```text
code history
durable artifact store
branch transport
optional coordination substrate
```

але не автоматично:

```text
global transaction coordinator
identity provider
authorization system
deployment controller
```

---

# 42. Git atomicity domain

Git conditional ref update може гарантувати atomicity для відповідного ref transaction.

Це не означає atomicity для:

```text
Git ref
+
database row
+
CI state
+
external deployment
```

Тому cross-system transition має explicit coordinator/protocol.

---

# 43. State backend profiles

## Profile A — Transactional store

Canonical state у database/coordination service:

```text
strong transactions
CAS
conditional updates
```

Git — artifact/history layer.

## Profile B — Git-backed state

Canonical state зберігається через Git objects/refs.

Потрібні:

```text
conditional ref update
single authoritative remote
server-side enforcement
```

## Profile C — Event-backed state

Immutable events:

```text
append-only
ordered
projected
```

Відновлення projection:

```text
replay events
```

---

# 44. Recommended architecture

Для high-reliability systems:

```text
                    ┌─────────────────────┐
                    │ AUTHENTICATED ACTOR │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ AUTHZ / CAPABILITY  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │ TRANSACTION GATE    │
                    │  CAS / TX / FENCE   │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
       ┌─────────────────┐          ┌─────────────────┐
       │ CANONICAL STATE │          │ EVENT / AUDIT   │
       └────────┬────────┘          └─────────────────┘
                │
                ▼
       ┌─────────────────┐
       │ GIT / CI / TEST │
       └────────┬────────┘
                │
                ▼
       ┌─────────────────┐
       │ DEPLOYMENT GATE │
       └────────┬────────┘
                │
                ▼
       ┌─────────────────┐
       │ RUNTIME EVIDENCE│
       └─────────────────┘
```

---

# 45. State machine

Canonical task states:

```text
TODO
CLAIMED
ACTIVE
BLOCKED
REVIEW
APPROVED
MERGE_QUEUED
INTEGRATED
RELEASE_READY
DEPLOY_QUEUED
DEPLOYING
DEPLOYED_UNVERIFIED
HEALTHY
DONE
ABANDONED
CANCELLED
STUCK
REBASE_REQUIRED
REVALIDATION_REQUIRED
```

---

# 46. Valid transitions

```text
TODO → CLAIMED
CLAIMED → ACTIVE
ACTIVE → BLOCKED
BLOCKED → ACTIVE
ACTIVE → REVIEW
REVIEW → ACTIVE
REVIEW → APPROVED
APPROVED → MERGE_QUEUED
MERGE_QUEUED → REVALIDATION_REQUIRED
REVALIDATION_REQUIRED → MERGE_QUEUED
MERGE_QUEUED → INTEGRATED
INTEGRATED → RELEASE_READY
RELEASE_READY → DEPLOY_QUEUED
DEPLOY_QUEUED → DEPLOYING
DEPLOYING → DEPLOYED_UNVERIFIED
DEPLOYED_UNVERIFIED → HEALTHY
HEALTHY → DONE
ACTIVE → ABANDONED
TODO → CANCELLED
```

Некожна repository використовує всі states.

---

# 47. State transition guards

Не можна переходити між state лише редагуванням YAML.

Кожен transition:

```text
must pass atomic transition primitive
```

Transition result:

```text
COMMITTED
REJECTED
CONFLICT
STALE
UNKNOWN
```

---

# 48. Unknown state

`UNKNOWN` є first-class state of knowledge, але не business success.

Приклад:

```text
deploy request sent
response lost
```

Результат:

```text
deployment = UNKNOWN
```

а не:

```text
DEPLOYED
```

Reconciliation:

```text
query authoritative deployment state
verify deployment_id
verify source_sha
verify artifact_digest
```

---

# 49. Idempotency semantics

Для кожної consequential operation:

```text
operation_id
request_hash
result
```

Поведінка:

```text
same operation + same request
→ return previous result

same operation + different request
→ CONFLICT

unknown prior result
→ RECONCILE
```

---

# 50. Reconciliation

Reconciliation не є retry.

```text
RETRY
=
repeat operation

RECONCILE
=
discover actual state before deciding next action
```

Після timeout:

```text
UNKNOWN
→ READ AUTHORITATIVE STATE
→ DETERMINE ACTUAL OUTCOME
→ CONTINUE
```

---

# 51. Retry policy

Retry допускається лише для класифікованих transient failures.

```text
TRANSIENT → bounded retry
PERMANENT → fail
UNKNOWN → reconcile
```

Параметри:

```text
max_attempts
backoff
jitter
deadline
```

---

# 52. Side effects

Transition може мати external side effects.

Небезпечно:

```text
commit state
then send external command
```

без recovery model.

Краще:

```text
state = COMMAND_QUEUED
```

→ durable command

→ worker executes

→ records result

→ conditional transition.

---

# 53. Outbox pattern

Для cross-system side effects рекомендується:

```text
TRANSACTION:
  update state
  write outbox command
```

потім:

```text
OUTBOX WORKER
→ execute
→ record result
→ conditional transition
```

Це запобігає:

```text
state committed
but external action forgotten
```

---

# 54. Inbox / deduplication

External callbacks should support:

```text
event_id
operation_id
source_system
sequence/version
```

Duplicate callback:

```text
same event_id
→ ignore/idempotently acknowledge
```

Conflicting duplicate:

```text
same event_id + different payload hash
→ SECURITY / DATA INTEGRITY ALERT
```

---

# 55. Deployment protocol

Deployment is a typed operation:

```text
BUILD
VERIFY
AUTHORIZE
EXECUTE
OBSERVE
```

Required identity:

```text
source_sha
artifact_digest
build_id
deployment_id
target_environment
rollback_target
```

---

# 56. Deployment authorization

Required:

```text
authenticated actor
valid DEPLOY capability
current task/release state
current fence
exact artifact identity
valid approval
valid environment policy
```

---

# 57. Deployment state machine

```text
NOT_READY
→ BUILD_READY
→ VERIFIED
→ AUTHORIZED
→ DEPLOYING
→ DEPLOYED_UNVERIFIED
→ HEALTHY
```

Failure:

```text
DEPLOYING
→ FAILED
→ ROLLBACK or HOLD
```

---

# 58. Deployment callback fencing

Every callback:

```text
deployment_id
operation_id
source_sha
artifact_digest
fence_token
incarnation
```

must be checked before state mutation.

Apply callback only via:

```text
conditional_transition
```

---

# 59. Rollback model

Rollback must identify exact:

```text
source_sha
artifact_digest
build_id
schema_state
configuration version
```

Application rollback and data/schema rollback are separate concepts.

Possible policy:

```text
ROLLBACK_CODE
ROLLBACK_DATA
ROLL_FORWARD
HOLD
```

---

# 60. Runtime truth

Runtime health is evidence, not declaration.

Example:

```yaml
runtime_evidence:
  deployment_id: dep-foo-001
  source_sha: <SHA>
  artifact_digest: <HASH>

  checks:
    - name: health
      result: PASS
    - name: smoke
      result: PASS
    - name: version_identity
      result: PASS
```

---

# 61. Local / production parity

Unit tests do not prove effective production behavior.

Where relevant validate:

```text
local behavior
+
effective production path
```

including:

```text
proxy
routing
TLS
WAF
auth gateway
filesystem exposure
environment configuration
```

---

# 62. Sandbox

Task execution should be isolated:

```text
worktree
process
filesystem
network
credentials
temporary storage
database
cache
ports
```

Where practical:

```text
rootless container
no-new-privileges
dropped capabilities
restricted network
resource limits
timeout
ephemeral state
```

Local hook is never the sole security boundary.

---

# 63. Worktree isolation

For parallel tasks:

```bash
git worktree add -b task/TASK-001 ../wt-TASK-001 main
```

But worktree isolation is not equivalent to total repository configuration isolation.

Where needed, use worktree-specific configuration and infrastructure-level sandboxing.

---

# 64. Shared resource isolation

Parallel tasks must not silently share mutable:

```text
/tmp
database
cache
queue
ports
uploads
runtime directories
processes
cloud resources
```

Use collision-free allocators.

---

# 65. Database safety

Migration tasks must declare:

```yaml
database:
  schema_change: true
  migration_id: MIG-001
```

Important operations may require:

```text
resource lock
```

or explicit serialization.

For data migration:

```text
DRY-RUN
→ SAMPLE
→ BOUNDED EXECUTION
→ POST-CHECK
```

---

# 66. API evolution

Prefer:

```text
ADD
→ MIGRATE
→ DEPRECATE
→ REMOVE
```

unless explicit breaking change.

Review binding should include:

```text
contract_sha
schema version
consumer compatibility
```

---

# 67. Path and resource locks

Two dimensions:

```text
PATH LOCK
RESOURCE LOCK
```

Examples:

```text
database/migrations/**
RELEASE
DEPLOYMENT
CREDENTIAL_ROTATION
```

A non-overlapping path can still conflict through a shared resource.

---

# 68. Evidence of progress

Progress evidence should not prolong lease forever.

Use:

```text
progress evidence
+
deadline
+
state
+
resource activity
```

A task can be:

```text
ACTIVE
```

without new commit if verified external work is occurring.

---

# 69. STUCK detection

Recommended conditions:

```text
lease near/over expiry
AND
no trusted progress evidence
AND
no protected active operation
AND
no documented BLOCKED state
```

`HEAD unchanged` alone is insufficient evidence.

---

# 70. Protected files

Typical:

```text
.github/workflows/**
CODEOWNERS
MULTI-AGENT.md
specs/architecture/**
specs/security/**
database/migrations/**
deploy/**
release automation
security policy
```

Protection must be enforced remotely where possible.

---

# 71. Secrets

Never commit:

```text
credentials
tokens
private keys
production secrets
session cookies
production dumps
```

Audit artifacts must not accidentally contain secrets.

---

# 72. Artifact integrity and provenance

Digest:

```text
SHA-256
```

proves content identity.

It does not alone prove provenance.

For critical artifacts prefer:

```text
artifact signature
builder identity
build attestation
source provenance
```

---

# 73. Deterministic builds

Build identity should include:

```text
source_sha
lockfiles
toolchain
builder image digest where applicable
configuration
artifact digest
```

Avoid:

```text
latest
floating dependency
mutable external artifact
unrecorded local package
```

---

# 74. Audit model

For consequential operations record:

```yaml
operation_id: op-foo-001
task_id: TASK-001

actor_id: agent-foo
identity_key_id: key-123

action: CLAIM

expected_state_version: 41
expected_fence_token: 14
expected_incarnation: 3
expected_contract_sha: <HASH>

result: COMMITTED

from_state_version: 41
to_state_version: 42

occurred_utc: <UTC>

evidence:
  - ev-foo-001
```

Audit entries are immutable.

---

# 75. Garbage collection

GC applies only after:

```text
terminal state
+
audit retention satisfied
+
no pending operations
+
no pending callbacks
+
no required legal/security retention
```

Use tombstones where delayed events are possible.

Lifecycle:

```text
ACTIVE
→ TERMINAL
→ TOMBSTONE
→ RETAIN
→ GC
```

---

# 76. Corruption recovery

Canonical projection corruption:

```text
DETECT
→ FREEZE CONSEQUENCES
→ LOAD EVENTS
→ VALIDATE EVENTS
→ REBUILD PROJECTION
→ VERIFY
→ UNFREEZE
```

If event log is also inconsistent:

```text
SAFE STOP
→ trusted backup / quorum / human recovery
```

---

# 77. Remote outage

Do not fabricate:

```text
ownership
approval
deployment result
merge result
```

After reconnect:

```text
FETCH
→ RECONCILE
→ VERIFY STATE VERSION
→ VERIFY FENCE
→ VERIFY CONTRACT
→ CONTINUE
```

---

# 78. Clock model

Local time must not be the only authority for ownership.

Use:

```text
authoritative server time
lease version
fence
state version
```

Clock skew may be monitored, but fencing remains version-based.

---

# 79. Safety invariants

## S1 — Single authoritative ownership

```text
For each task and current ownership epoch:
at most one authoritative owner exists.
```

## S2 — Monotonic fencing

```text
fence(t+1) >= fence(t)
```

and never decreases.

## S3 — Monotonic state version

```text
state_version(t+1) = state_version(t) + 1
```

for each committed transition.

## S4 — Contract binding

```text
consequential evidence
→ exact current or explicitly approved contract identity
```

## S5 — Stale rejection

```text
old fence OR old incarnation
→ consequential operation rejected
```

## S6 — No blind overwrite

```text
version mismatch
→ conflict/reconcile
```

## S7 — No implicit deployment

```text
INTEGRATED != DEPLOYED != HEALTHY
```

## S8 — No unauthorized transition

```text
missing capability
→ reject
```

## S9 — No unknown-as-success

```text
UNKNOWN != SUCCESS
```

## S10 — Event durability

```text
committed state transition
→ durable transition evidence
```

---

# 80. Liveness properties

Liveness depends on infrastructure assumptions.

Under:

```text
eventual network recovery
eventual scheduler progress
non-corrupt authoritative store
```

the protocol should permit:

```text
reclaim expired ownership
retry transient operations
advance queue
complete healthy tasks
```

Liveness must never override safety.

---

# 81. Formal transition pseudocode

```text
function conditional_transition(req):

    authenticate(req.actor)

    authorize(
        actor=req.actor,
        capability=req.capability,
        action=req.action
    )

    current = read_canonical_state(req.task_id)

    if current.state.version != req.expected_state_version:
        return CONFLICT

    if current.ownership.fence_token != req.expected_fence_token:
        return STALE

    if current.ownership.incarnation != req.expected_incarnation:
        return STALE

    if current.contract.sha256 != req.expected_contract_sha:
        return STALE

    if operation_already_committed(req.operation_id):
        return replay_previous_result(req.operation_id)

    verify_transition_preconditions(current, req)

    verify_evidence(req.evidence)

    next = apply_transition(current, req)

    atomically:
        persist(next)
        append_transition_event(req, current, next)
        record_operation_result(req.operation_id, COMMITTED)

    return COMMITTED
```

---

# 82. Atomicity requirement

The pseudocode above is conceptual.

Implementation must guarantee that no concurrent actor can create:

```text
STATE=N
```

→ both:

```text
STATE=N+1
STATE=N+1
```

from the same expected version.

One must win.

Other must receive:

```text
CONFLICT
```

---

# 83. CAS formulation

Abstractly:

```text
CAS(
    resource = TASK-001,
    expected_version = 41,
    expected_fence = 14,
    expected_incarnation = 3,
    expected_contract_sha = H,
    operation_id = O,
    transition = T
)
```

Result:

```text
COMMITTED
CONFLICT
STALE
REJECTED
UNKNOWN
```

---

# 84. Compare-and-swap semantics

`CAS` means:

```text
READ condition
AND
MODIFY
```

must belong to one authoritative atomic transaction.

This protocol does not accept:

```text
client read
→ arbitrary client logic
→ later blind write
```

for consequential transitions.

---

# 85. Human authorization

Human approval is itself an authenticated transition request.

Minimum:

```yaml
authorization:
  authorization_id: auth-foo-001
  actor_id: human-foo
  operation_id: op-foo-001
  decision: APPROVE
  expires_utc: <UTC>
  signature: <SIGNATURE>
```

Human authorization cannot bypass immutable security constraints.

---

# 86. Emergency mode

Emergency mode must be typed:

```text
EMERGENCY_STANDARD
EMERGENCY_BYPASS
```

Every bypass must record:

```text
who
why
what was bypassed
scope
start
expiry
follow-up review
```

Emergency bypass should have bounded lifetime.

---

# 87. Review and authorization separation

Do not collapse:

```text
REVIEW
APPROVAL
AUTHORIZATION
```

A reviewer answers:

```text
"Is this change acceptable according to review scope?"
```

An authorizer answers:

```text
"May this consequential state transition occur?"
```

---

# 88. Commit protocol

Recommended:

```text
<type>(<scope>): <summary>

Task: TASK-001
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
build
ci
```

Commit identity remains distinct from protocol authorization identity.

---

# 89. Branch model

Recommended:

```text
task/<TASK_ID>
hotfix/<TASK_ID>
release/<VERSION>
```

Protected `main` should not receive unreviewed direct feature changes.

---

# 90. Rebase

After rebase:

```text
base_sha changes
```

therefore review and verification validity must be evaluated against:

```text
new base
new head
same contract
dependency state
```

---

# 91. Conflict handling

Never resolve conflicts blindly:

```text
ours
theirs
latest
```

Use:

```text
STOP
→ UNDERSTAND BOTH INTENTS
→ RESOLVE
→ TEST
→ REVIEW
```

---

# 92. Merge admission

Before protected integration:

```text
authenticated actor
valid merge capability
current task state
current fence
current contract
valid approval
required CI
current candidate base
no unresolved conflicts
```

Then:

```text
conditional_transition
```

---

# 93. Deployment admission

Before deployment:

```text
authenticated deploy actor
valid DEPLOY capability
exact source_sha
exact artifact_digest
valid approval
current release state
current fence
rollback target
```

---

# 94. Finalization

`DONE` means the task contract is complete.

At minimum:

```text
acceptance satisfied
required verification PASS
required review PASS
integration complete
audit complete
canonical state consistent
```

Deployment verification, where applicable:

```text
artifact identified
deployment authorized
deployment completed
health verified
smoke verified
rollback target known
```

---

# 95. Conformance tests

Protocol implementation should include:

```text
test_single_owner
test_claim_race
test_reclaim_race
test_fence_monotonicity
test_incarnation_monotonicity
test_state_version_CAS
test_stale_actor_rejected
test_stale_callback_rejected
test_contract_hash_binding
test_operation_idempotency
test_operation_conflict
test_unknown_reconciliation
test_no_self_approval
test_review_invalidation
test_merge_queue_CAS
test_queue_revalidation
test_deploy_authorization
test_artifact_identity
test_projection_rebuild
test_tombstone_retention
test_secret_isolation
```

---

# 96. Adversarial scenario: claim race

```text
A reads version=10
B reads version=10

A submits CAS(10)
B submits CAS(10)

A → COMMITTED version=11
B → CONFLICT
```

Never:

```text
both → owner
```

---

# 97. Adversarial scenario: reclaim race

```text
A owns fence=14
R1 sees expired
R2 sees expired

R1 CAS(version=20, fence=14)
R2 CAS(version=20, fence=14)

R1 → fence=15, version=21
R2 → CONFLICT
```

---

# 98. Adversarial scenario: stale agent

```text
A fence=14
network partition

B reclaim
fence=15

A wakes

A operation fence=14
→ STALE
→ reject
```

---

# 99. Adversarial scenario: lost request response

```text
request sent
server commits
response lost
```

Client:

```text
UNKNOWN
```

Then:

```text
query operation_id
→ previous result = COMMITTED
→ replay result
```

No duplicate side effect.

---

# 100. Adversarial scenario: duplicate request

```text
operation_id=op-001
request hash=H1
```

repeat:

```text
op-001
H1
```

returns original result.

Repeat:

```text
op-001
H2
```

returns:

```text
CONFLICT
```

---

# 101. Adversarial scenario: delayed CI callback

```text
CI run created for fence=14
reclaim
fence=15
CI callback arrives
```

Callback:

```text
fence=14
```

Result:

```text
STALE
```

It may be retained as historical evidence but cannot mutate current task state.

---

# 102. Adversarial scenario: stale review

```text
review:
contract=H1
base=A
head=X
```

Then:

```text
contract=H2
```

or:

```text
head=Y
```

Review:

```text
INVALID
```

---

# 103. Adversarial scenario: delayed deployment response

```text
deploy request
remote success
network timeout
```

Local state:

```text
UNKNOWN
```

Reconciliation queries:

```text
deployment_id
```

and verifies:

```text
source_sha
artifact_digest
environment
```

Only then:

```text
DEPLOYED_UNVERIFIED
```

---

# 104. Adversarial scenario: deployment partially succeeds

State:

```text
DEPLOYING
```

Some targets updated.

Protocol must not infer:

```text
DEPLOYED
```

Instead:

```text
PARTIAL / UNKNOWN
→ observe target topology
→ determine exact state
→ rollback / continue / hold
```

---

# 105. Adversarial scenario: corrupted projection

If projection says:

```text
ACTIVE version=42
```

but event log ends at:

```text
version=41
```

then:

```text
projection invalid
→ freeze consequences
→ rebuild projection
```

Never silently increment to version 43.

---

# 106. Adversarial scenario: malicious local hook bypass

Agent executes:

```text
git push --no-verify
```

or deletes local hook.

Expected:

```text
local guard bypassed
```

but remote enforcement still rejects forbidden operation.

---

# 107. Adversarial scenario: capability theft

A obtains stale credential.

Credential epoch:

```text
8
```

current:

```text
9
```

Authorization:

```text
REJECTED
```

---

# 108. Adversarial scenario: capability scope violation

Capability:

```yaml
capability: DEPLOY
scope:
  environment: staging
```

Operation:

```text
DEPLOY production
```

Result:

```text
REJECTED
```

---

# 109. Adversarial scenario: task contract substitution

Agent holds claim for:

```text
contract=H1
```

Coordinator sees:

```text
contract=H2
```

Agent submit:

```text
contract=H1
```

Result:

```text
STALE
```

No approval.

---

# 110. Adversarial scenario: queue worker race

Workers:

```text
W1
W2
```

both read:

```text
queue_version=17
candidate=C1
```

Only one:

```text
CAS(17)
```

can reserve candidate.

The other:

```text
CONFLICT
→ reread queue
```

---

# 111. Shared state pollution

If a task uses:

```text
global /tmp
global cache
shared DB
hard-coded port
global daemon
```

without allocation:

```text
environment isolation violation
```

and the task should be:

```text
BLOCKED
```

until isolated.

---

# 112. Database transaction safety

Where external database transactions are available, use native transaction semantics.

Where not available:

```text
outbox
idempotency
versioned migrations
bounded compensation
```

Never assume cross-system rollback is automatic.

---

# 113. Compensation vs rollback

Some side effects cannot be technically rolled back.

Distinguish:

```text
ROLLBACK
COMPENSATION
ROLL-FORWARD
HOLD
```

Task contract must identify which is possible.

---

# 114. Observability of protocol itself

Protocol infrastructure should expose:

```text
claim conflicts
reclaim frequency
stale callback count
transition rejection count
UNKNOWN operations
queue latency
review latency
deployment failures
fence violations
capability rejection
```

These are operational health signals.

---

# 115. Metrics that indicate protocol failure

Watch for:

```text
high CLAIM_CONFLICT rate
high RECLAIM rate
high UNKNOWN rate
high STALE callback rate
high review invalidation rate
queue starvation
long lease duration
repeated operation conflicts
```

A system that technically remains safe but constantly reaches `UNKNOWN` is operationally unhealthy.

---

# 116. Audit integrity

Audit itself needs integrity.

At minimum:

```text
immutable event identity
ordered sequence
operation id
actor identity
payload hash
timestamp
```

For high-assurance deployments consider:

```text
signed event
hash chain
append-only external log
```

---

# 117. Hash chaining

Optional stronger audit:

```yaml
event_seq: 102
event_hash: <HASH>
previous_event_hash: <HASH>
```

Then:

```text
event_hash = H(event_payload + previous_event_hash)
```

This detects some history tampering.

Hash chaining alone does not prove who authored the event; signatures/authoritative storage address identity.

---

# 118. Data retention

Retention policy must distinguish:

```text
operational records
security audit
review artifacts
deployment records
legal retention
debug artifacts
```

GC must use retention policy, not just task terminality.

---

# 119. Reconciliation authority

When sources disagree:

```text
canonical transaction state
>
event log
>
trusted external system evidence
>
Git state
>
task artifacts
>
local state
```

Exact ordering can be backend-specific, but must be explicitly defined.

---

# 120. Never silently repair

Repair operation must itself be a consequential transition:

```text
REPAIR_REQUESTED
→ REPAIRED
```

with:

```text
operation_id
actor
reason
evidence
old state
new state
```

---

# 121. Protocol doctor

Recommended:

```text
agentctl doctor
```

checks:

```text
identity
credentials
capabilities
repository connectivity
canonical state reachability
CAS availability
worktree
sandbox
CI
clock
required tooling
```

`UNKNOWN` is not `PASS`.

---

# 122. Protocol CLI semantics

Recommended interface:

```text
agentctl task validate <TASK_ID>
agentctl claim <TASK_ID>
agentctl heartbeat <TASK_ID>
agentctl reclaim <TASK_ID>
agentctl review <TASK_ID>
agentctl approve <TASK_ID>
agentctl merge-check <TASK_ID>
agentctl deploy-check <TASK_ID>
agentctl reconcile <TASK_ID>
agentctl doctor
```

These are semantic examples; implementations may differ.

---

# 123. Command safety rule

CLI commands must distinguish:

```text
READ
PLAN
VALIDATE
COMMIT
EXECUTE
RECONCILE
```

Dry-run must not be interpreted as actual authorization.

---

# 124. State query semantics

A state read should identify:

```yaml
task_id: TASK-001
state_version: 42
fence_token: 15
incarnation: 4
contract_sha256: <HASH>
observed_utc: <UTC>
authoritative_source: <SOURCE>
```

This makes stale reads detectable.

---

# 125. Cache policy

Cached canonical state can be used for:

```text
UI
performance
non-consequential planning
```

but not for final authorization of:

```text
claim
reclaim
approve
merge
deploy
credential mutation
```

unless cache carries and validates an authoritative version/freshness contract.

---

# 126. Network partition policy

When authoritative state cannot be reached:

```text
READ operations may use stale data for planning
CONSEQUENTIAL operations must stop or use formally delegated authority
```

This distinction is critical.

---

# 127. Delegated authority

If a coordinator is allowed to operate temporarily during partition, it must possess explicit:

```text
delegation_id
scope
expiry
fence range
resource range
```

No implicit delegation.

---

# 128. Quorum / consensus note

v5 itself does not implement consensus.

If multiple independent authorities can make mutually conflicting canonical decisions, a stronger consensus mechanism may be required:

```text
single trusted writer
or
transactional coordinator
or
consensus/quorum system
```

Two unsynchronized Git writers do not magically constitute consensus.

---

# 129. Performance principle

Correctness boundary should be small.

Prefer:

```text
short atomic transaction
+
durable event
+
asynchronous external work
```

rather than:

```text
huge transaction
containing build/test/network/deploy
```

---

# 130. Long-running operations

Long operation should become state:

```text
COMMAND_QUEUED
RUNNING
SUCCEEDED
FAILED
UNKNOWN
```

rather than holding a database/Git lock for hours.

---

# 131. Build/test orchestration

Example:

```text
ACTIVE
→ TEST_QUEUED
→ TEST_RUNNING
→ TEST_SUCCEEDED
```

or:

```text
TEST_RUNNING
→ TEST_FAILED
```

The worker must report result using operation identity.

---

# 132. Process lease vs task lease

These are different:

```text
TASK LEASE
=
authority to work on task

PROCESS LEASE
=
liveness of a worker execution
```

A process can die while task work remains recoverable.

Do not conflate them.

---

# 133. Recovery after process restart

On restart:

```text
authenticate
→ discover actor state
→ read canonical task
→ compare fence/incarnation
```

If still owner:

```text
resume
```

If stale:

```text
stop consequential actions
preserve work
handoff/reconcile
```

---

# 134. Local uncommitted work recovery

Never assume uncommitted work is safe.

Recommended:

```text
checkpoint patches
temporary artifact
agent-local recovery bundle
```

where policy permits.

Committed work remains easier to recover.

---

# 135. Review workflow

Recommended:

```text
IMPLEMENT
→ VERIFY
→ REQUEST_REVIEW
→ INDEPENDENT_REVIEW
→ APPROVE/REJECT
→ REVALIDATE
→ MERGE_QUEUE
```

Each stage is a typed operation.

---

# 136. Review scope immutability

Review artifact must include exact:

```text
contract
base
head
evidence set
```

If any critical identity changes:

```text
review invalidated
```

---

# 137. Critical change policy

Critical areas:

```text
authentication
authorization
cryptography
payments
destructive database operations
credential systems
release infrastructure
production access
security controls
```

Recommended:

```text
2 independent reviews
security review where relevant
required CI
explicit authorization
full audit
```

---

# 138. Change classification

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Risk classification is part of canonical task contract.

Agent must not silently lower risk.

---

# 139. Risk escalation

Risk may be escalated:

```text
MEDIUM → HIGH
HIGH → CRITICAL
```

automatically when detected.

Risk reduction should require explicit authorized transition.

---

# 140. Specification truth

Architecture/security/product/deployment specifications are separate source-of-truth domains.

Recommended:

```text
specs/
  architecture/
  security/
  product/
  deployment/
```

A task must reference the relevant specification revision where applicable.

---

# 141. Architecture decisions

For significant changes:

```text
Context
Decision
Alternatives
Consequences
Migration
Rollback
Security
Operations
```

ADR identity can be included in contract hash.

---

# 142. Dependency updates

Require:

```text
lockfile
security scan
compatibility
reproducible build
license/policy checks where applicable
```

Dependency update changes may invalidate review.

---

# 143. Secret scanning

At minimum before protected integration:

```text
secret scan
```

Critical repositories should enforce remote scanning.

---

# 144. Security policy enforcement

Security controls that matter must be machine-enforced where possible:

```text
branch protection
required review
required CI
capability checks
deployment gates
artifact verification
fence validation
```

Local policy alone is insufficient.

---

# 145. Protected branch model

`main`:

```text
protected
reviewed
CI-gated
audited
```

Bypass authority:

```text
explicit
minimal
time-bounded where possible
audited
```

`PROTECTED != IMMUTABLE`.

---

# 146. Release state

Release identity should contain:

```yaml
release_id: rel-foo-001
source_sha: <SHA>
artifact_digest: <HASH>
contract_set_hash: <HASH>
authorization_ref: auth-foo-001
```

---

# 147. Runtime smoke tests

Generic examples:

```text
GET /health
GET /api/health
GET /api/does-not-exist
GET /internal/example
```

Expected result belongs to task/project contract.

---

# 148. Production environment safety

Do not assume:

```text
local path == remote path
local topology == production topology
```

Deployment procedure must discover and validate effective target.

---

# 149. Outbound network policy

Sandboxed tasks should use:

```text
deny by default
explicit egress allowlist where practical
```

unless task requires broader access.

---

# 150. Runtime credential policy

Never inject production credentials into generic task workers.

Use:

```text
task-scoped
operation-scoped
environment-scoped
short-lived
revocable
```

credentials where possible.

---

# 151. Resource quotas

Parallel tasks should have quotas:

```text
CPU
memory
disk
processes
network
database connections
queue capacity
```

Quota exhaustion should result in:

```text
RESOURCE_BLOCKED
```

not silent interference with another task.

---

# 152. Priority inversion

Shared resource locks may cause:

```text
high-priority task
waiting for low-priority owner
```

Policy may use:

```text
aging
preemption
graceful handoff
bounded lease
```

but forced preemption must preserve safety/fencing.

---

# 153. Fair scheduling

Scheduler should avoid permanent starvation.

Useful policy:

```text
priority
+
aging
+
max residence
+
failure penalty
```

These are scheduling controls, not correctness controls.

---

# 154. Cancellation

Cancellation is a state transition:

```text
ACTIVE → CANCELLED
```

Only authorized actor can issue it.

In-flight external operations must be handled explicitly.

---

# 155. Abandonment

Abandonment should preserve:

```text
latest source_sha
artifact refs
review evidence
failure reasons
recovery notes
```

Branch deletion is separate cleanup action.

---

# 156. State machine vs workflow

Do not confuse:

```text
workflow convenience
```

with:

```text
canonical state
```

A UI may hide states, but underlying canonical transition semantics remain authoritative.

---

# 157. Multiple projections

The same event stream can project:

```text
task dashboard
audit log
queue status
agent status
deployment status
metrics
```

Only canonical transaction state decides authorization.

---

# 158. Eventual consistency

Read models may be eventually consistent.

Therefore:

```text
eventually consistent UI
!=
authoritative transaction state
```

Consequential operation must reach authoritative writer.

---

# 159. Failure-closed defaults

For security-sensitive operations:

```text
missing evidence
→ reject

unknown actor
→ reject

unknown capability
→ reject

stale fence
→ reject

ambiguous state
→ stop/reconcile

unknown deployment outcome
→ reconcile
```

---

# 160. Failure-open is explicit only

Any failure-open behavior must be separately documented:

```yaml
failure_mode:
  behavior: FAIL_OPEN
  reason: <reason>
  scope: <scope>
  expiry: <UTC>
  approval: <REF>
```

---

# 161. Verification matrix

| Operation | Required identity | Version | Fence | Contract | Evidence |
|---|---|---:|---:|---:|---|
| CLAIM | yes | yes | create | yes | eligibility |
| HEARTBEAT | yes | yes | yes | yes | progress |
| RECLAIM | yes | yes | yes | yes | lease state |
| REVIEW | yes | yes | yes | yes | review evidence |
| APPROVE | yes | yes | yes | yes | review artifact |
| MERGE | yes | yes | yes | yes | CI/review |
| DEPLOY | yes | yes | yes | yes | artifact/approval |
| CALLBACK | yes | yes | yes | yes | callback evidence |

---

# 162. Protocol consistency check

`agentctl doctor` should flag:

```text
state.version mismatch
contract hash mismatch
fence inconsistency
incarnation inconsistency
missing ownership evidence
missing event
duplicate operation
stale capability
unknown queue generation
artifact provenance mismatch
```

---

# 163. Protocol conformance levels

## Level 0 — Documentation

Only policy exists.

```text
NOT SECURE ENFORCEMENT
```

## Level 1 — Git-enforced

```text
protected branches
conditional refs
CI
review
```

## Level 2 — Transactional

```text
canonical state
CAS
operation identity
fence
authenticated authority
```

## Level 3 — High assurance

```text
attested evidence
signed transitions
immutable audit
strong deployment controller
isolated execution
recovery testing
```

---

# 164. Production readiness criteria

v5 may be considered production-ready only if implementation demonstrates:

```text
authenticated actors
authoritative state
CAS/transaction primitive
fence enforcement
operation idempotency
server-side policy enforcement
review independence
deployment authorization
runtime verification
audit retention
recovery
conformance tests
adversarial tests
```

Documentation alone is insufficient.

---

# 165. Property-based testing

Generate random sequences of:

```text
CLAIM
HEARTBEAT
RECLAIM
COMMIT
REBASE
REVIEW
APPROVE
QUEUE
MERGE
DEPLOY
CALLBACK
CANCEL
RESTART
```

Inject:

```text
timeouts
duplicates
reordering
partitions
stale messages
crashes
```

Assert invariants:

```text
single ownership
monotonic fence
monotonic state version
no unauthorized transition
no stale callback mutation
```

---

# 166. Model checking

For the core state machine, a small formal model may be checked using:

```text
TLA+
PlusCal
Alloy
state-space model checker
property-based state machine testing
```

The purpose is not to prove the entire application correct.

The purpose is to verify:

```text
ownership
CAS
fencing
reclaim
idempotency
```

---

# 167. Minimal formal model

Definitions:

```text
Task
Agent
StateVersion ∈ Nat
Fence ∈ Nat
Incarnation ∈ Nat
OperationId
ContractHash
```

Invariant:

```text
∀ task:
  active_owner_count(task, current_epoch) <= 1
```

Fence invariant:

```text
Fence' >= Fence
```

Version invariant:

```text
Version' = Version + 1
```

for each committed transition.

Stale rule:

```text
req.fence < current.fence
→ reject
```

Version rule:

```text
req.version != current.version
→ reject
```

---

# 168. Reference transition algebra

```text
VALID(req, S) :=
    authenticated(req.actor)
    AND authorized(req.actor, req.capability, req.action)
    AND req.expected_state_version = S.state.version
    AND req.expected_contract_sha = S.contract.sha256
    AND req.expected_fence = S.ownership.fence_token
    AND req.expected_incarnation = S.ownership.incarnation
    AND preconditions(req, S)
```

Then:

```text
COMMIT(req, S) =
    S' where
      S'.state.version = S.state.version + 1
      S' = apply(req, S)
```

and:

```text
¬VALID(req, S)
→ no state mutation
```

---

# 169. Fundamental protocol law

```text
NO STATE TRANSITION
WITHOUT
AUTHENTICATED ACTOR
+
AUTHORIZED CAPABILITY
+
EXPECTED VERSION
+
CURRENT FENCE
+
CURRENT INCARNATION
+
CURRENT CONTRACT
+
VALID EVIDENCE
+
ATOMIC COMMIT
```

This is the core of v5.

---

# 170. Failure semantics law

```text
FAILURE
→ do not guess
→ do not overwrite
→ do not duplicate blindly
→ reconcile
```

---

# 171. Staleness law

```text
STALE DATA
→ MAY INFORM PLANNING
→ MUST NOT AUTHORIZE CONSEQUENTIAL ACTION
```

---

# 172. Audit law

```text
CONSEQUENTIAL ACTION
→ DURABLE OPERATION ID
→ DURABLE RESULT
→ DURABLE EVIDENCE
```

---

# 173. Recovery law

```text
RECOVERY
!=
DELETE AND RETRY

RECOVERY
=
RECONSTRUCT AUTHORITATIVE STATE
+
VERIFY IDENTITY
+
VERIFY VERSION/FENCE
+
CONTINUE OR COMPENSATE
```

---

# 174. Security law

```text
DOCUMENTED POLICY
+
AUTHENTICATED AUTHORITY
+
MACHINE ENFORCEMENT
+
DURABLE EVIDENCE
=
ACTUAL CONTROL
```

---

# 175. Universal placeholder policy

Цей універсальний документ не повинен містити реальних:

```text
project names
private URLs
real domains
real hosts
credentials
production filesystem paths
service-specific secrets
```

Для прикладів:

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

---

# 176. Compatibility with legacy v4

v5 зберігає v4 concepts:

```text
task manifests
worktrees
leases
heartbeat
proof-of-progress
fence tokens
incarnation
review
merge queue
deployment gates
runtime verification
GC
sandbox
least privilege
security scans
rollback
```

Але змінює їх роль.

У v5 вони стають:

```text
POLICY / EVIDENCE / SIDE EFFECTS
```

поверх:

```text
CANONICAL STATE + TRANSACTION ENGINE
```

---

# 177. Migration path from v4

```text
Phase 1
introduce state.version

Phase 2
bind contract.sha256

Phase 3
introduce operation_id

Phase 4
introduce authenticated actor identity

Phase 5
introduce capabilities

Phase 6
centralize conditional transitions

Phase 7
bind fence/incarnation to every consequential operation

Phase 8
introduce durable event log

Phase 9
move callbacks and deployment through transactional gate

Phase 10
enable conformance/adversarial testing

Phase 11
remove legacy blind state writes
```

Legacy writes must be detected and eventually forbidden.

---

# 178. Migration safety

During migration:

```text
dual-read
```

may be allowed.

But for consequential state:

```text
one authoritative writer
```

must be established before enabling competing implementations.

---

# 179. Legacy compatibility fallback

If full transaction service is unavailable:

```text
Git-backed conditional refs
+
server-side enforcement
+
strict CAS semantics
```

may implement a reduced profile.

But the implementation must explicitly state which guarantees are weakened.

---

# 180. Do not overclaim guarantees

The protocol does not prove:

```text
semantic correctness of arbitrary AI reasoning
perfect production health
correctness of external services
Byzantine tolerance of compromised trust roots
```

It proves only what the enforced transition/evidence model actually guarantees.

---

# 181. Final golden flow

```text
DISCOVER
    ↓
VALIDATE CONTRACT
    ↓
AUTHENTICATE ACTOR
    ↓
AUTHORIZE CAPABILITY
    ↓
READ CANONICAL STATE
    ↓
CLAIM VIA CAS/TX
    ↓
VERIFY FENCE + INCARNATION
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
PUBLISH EVIDENCE
    ↓
INDEPENDENT REVIEW
    ↓
APPROVE
    ↓
REVALIDATE STATE
    ↓
MERGE QUEUE
    ↓
ATOMIC INTEGRATION
    ↓
VERIFY MAIN
    ↓
AUTHORIZE DEPLOY
    ↓
DEPLOY VIA CONTROLLED OPERATION
    ↓
RUNTIME VERIFICATION
    ↓
RECORD
    ↓
TERMINATE
    ↓
TOMBSTONE
    ↓
GC WHEN SAFE
```

---

# 182. Final invariants

```text
NO AUTHORITY WITHOUT AUTHENTICATION.

NO OPERATION WITHOUT CAPABILITY.

NO WRITE WITHOUT EXPECTED VERSION.

NO CONSEQUENTIAL ACTION WITHOUT CURRENT FENCE.

NO OLD INCARNATION AFTER RECLAIM.

NO CONTRACT DRIFT.

NO STALE CALLBACK MUTATION.

NO BLIND RETRY.

NO UNKNOWN STATE AS SUCCESS.

NO UNREVIEWED PROTECTED INTEGRATION.

NO IMPLICIT DEPLOYMENT.

NO GC BEFORE RETENTION/QUIESCENCE.

NO SILENT REPAIR.

NO POLICY WITHOUT ENFORCEMENT.
```

---

# 183. Final operational doctrine

```text
POLICY defines what is allowed.

AUTHENTICATION defines who acts.

CAPABILITY defines what that actor may do.

CANONICAL STATE defines what is true.

STATE_VERSION defines whether the observation is still current.

FENCE defines which ownership epoch is current.

INCARNATION identifies the current ownership lineage.

EVIDENCE defines what actually happened.

OPERATION_ID defines one logical consequential action.

CAS/TRANSACTION defines whether the transition can commit.

EVENTS provide durable history.

PROJECTION provides recoverable current state.

RECONCILIATION determines reality after uncertainty.

ENFORCEMENT prevents local intent from becoming unauthorized system state.
```

---

# 184. Final law

```text
A MULTI-AGENT SYSTEM IS NOT SAFE
BECAUSE ITS AGENTS PROMISE TO BEHAVE CORRECTLY.

IT IS SAFE WHEN
THE SYSTEM CAN AUTHORITATIVELY DETERMINE:

WHO IS ACTING,
WHAT THEY ARE ALLOWED TO DO,
WHICH STATE IS CURRENT,
WHICH CONTRACT IS CURRENT,
WHICH OWNERSHIP EPOCH IS CURRENT,
WHICH OPERATION IS BEING EXECUTED,
WHAT EVIDENCE SUPPORTS IT,
AND WHETHER THE TRANSITION CAN COMMIT ATOMICALLY.
```

І тому центральна модель v5:

```text
AUTHENTICATED ACTOR
        +
CAPABILITY
        +
CANONICAL STATE
        +
STATE_VERSION
        +
FENCE_TOKEN
        +
INCARNATION
        +
CONTRACT_HASH
        +
OPERATION_ID
        +
VERIFIABLE EVIDENCE
        ↓
ATOMIC CONDITIONAL TRANSITION
        ↓
DURABLE EVENT
        ↓
NEW CANONICAL STATE
```

Це є нормативним ядром протоколу.

---
