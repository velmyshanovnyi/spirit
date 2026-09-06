# MULTI-AGENT.md — Universal Multi-Agent Engineering Protocol

> **Version:** 3.0
>
> **Status:** normative
>
> **Scope:** one repository, one protocol for `Master`, `Slave`, human developers and
> automated coding agents.
>
> **Primary objective:** safe high-concurrency development with deterministic ownership,
> isolated execution, reproducible verification, auditable integration and controlled
> deployment.
>
> **Core rule:**
>
> ```text
> CLAIM → ISOLATE → SPECIFY → TEST → IMPLEMENT → VERIFY → REVIEW → HANDOFF → INTEGRATE → VERIFY
> ```

---

# 1. Protocol contract

This document is operational policy.

An agent MUST treat the repository state, CI state and recorded coordination state as
machine-checkable facts.

An agent MUST NOT rely on:

- chat memory;
- verbal claims;
- local assumptions;
- stale task descriptions;
- another agent saying that a task is "free";
- another agent saying that tests "should pass".

When the state cannot be established reliably:

```text
STOP → INSPECT → RECONCILE → CONTINUE
```

Unknown state is not equivalent to safe state.

---

# 2. Roles

There is one protocol and two authority levels.

```text
ROLE=master
ROLE=slave
```

If role is not explicitly established, default to:

```text
ROLE=slave
```

## 2.1 Master

Master may:

- modify architecture/specification ownership;
- approve architectural decisions;
- integrate branches;
- close reviews;
- authorize production deployment;
- perform privileged recovery operations;
- change coordination policy through reviewed commits.

Master MUST still execute all applicable quality and security gates.

Master authority does not imply:

```text
tests optional
review optional
audit optional
```

## 2.2 Slave

Slave may:

- claim eligible tasks;
- create isolated worktrees;
- implement assigned work;
- modify tests;
- run verification;
- produce review artifacts;
- push task branches;
- hand tasks to `REVIEW`.

Slave MUST NOT:

- force-push protected integration branches;
- merge another agent's work;
- deploy production;
- alter protected architecture/specification files outside explicit task scope;
- steal or mutate another active claim;
- bypass repository hooks/CI.

---

# 3. Authority hierarchy

When sources conflict, use this order:

```text
1. Explicit current-session owner authorization
2. Repository branch protection / CI policy
3. Git history and refs
4. Approved specifications
5. Task manifests / coordination state
6. Agent assumptions
```

Security policy overrides task convenience.

A task description cannot authorize an action forbidden by repository policy.

---

# 4. Repository truth model

Use four different concepts.

## 4.1 Git truth

Git objects, commits, refs and protected branches represent what exists.

## 4.2 Task truth

The task registry represents intended work.

Recommended structure:

```text
.backlog/
  tasks/
  reviews/
  decisions/
  leases/
```

A human-readable:

```text
BACKLOG.md
```

may exist as an index, but it MUST NOT be the sole lock mechanism.

## 4.3 Specification truth

Specifications define contracts and architecture.

Recommended:

```text
specs/
  architecture/
  product/
  security/
  deployment/
```

## 4.4 Runtime truth

A successful merge does not prove deployment.

A successful deployment does not prove application health.

Runtime state requires runtime evidence.

---

# 5. Recommended coordination architecture

The repository SHOULD use:

```text
                         ┌───────────────┐
                         │ task manifest │
                         └───────┬───────┘
                                 │
                                 ▼
                         ┌───────────────┐
                         │ atomic claim  │
                         │  Git ref      │
                         └───────┬───────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
          isolated worktree                coordination record
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                              task branch
                                 │
                                 ▼
                        test → implement
                                 │
                                 ▼
                               review
                                 │
                                 ▼
                         protected integration
                                 │
                                 ▼
                            deployment
                                 │
                                 ▼
                         runtime verification
```

---

# 6. Task manifests

Do not encode all tasks as mutable rows in one large shared Markdown table.

Preferred format:

```text
.backlog/tasks/<TASK_ID>.yaml
```

Example:

```yaml
id: API-142
title: Rotate session identifier after login
state: TODO

depends_on:
  - AUTH-017

risk: high

paths:
  - app/Auth/**
  - tests/Auth/**

exclusive_paths:
  - app/Auth/**
  - database/migrations/**

database: false
deployment: false

acceptance:
  - "session id changes after successful authentication"
  - "old session id becomes invalid"

required_checks:
  - unit
  - security
  - integration

review:
  required: true
  minimum_independent_reviewers: 1
```

Task manifests are immutable in intent after work starts.

If requirements change materially:

```text
old task → BLOCKED/CANCELLED
new task or explicit revision → new contract
```

Do not silently mutate acceptance criteria while implementation is underway.

---

# 7. Task states

Canonical states:

```text
TODO
CLAIMED
ACTIVE
BLOCKED
REVIEW
APPROVED
INTEGRATED
DONE
ABANDONED
CANCELLED
```

Normal path:

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
INTEGRATED
  ↓
DONE
```

Allowed recovery:

```text
CLAIMED  → TODO
ACTIVE   → BLOCKED
BLOCKED  → ACTIVE
REVIEW   → ACTIVE
ACTIVE   → ABANDONED
```

`DONE` is terminal except for explicit defect reopening.

---

# 8. Eligibility

An agent may claim a task only when:

```text
state == TODO
AND all dependencies == DONE or INTEGRATED
AND no active claim exists
AND task is within agent capability
```

Capability examples:

```text
CODE
TEST
DOCS
ARCHITECTURE
SECURITY
DEPLOY
RELEASE
```

Do not infer capability from role name.

---

# 9. Atomic claims — authoritative mechanism

## 9.1 Do NOT use a shared Markdown file as the lock

This is insufficient:

```text
read TODO
edit row → CLAIMED
commit
push
```

It creates unnecessary hotspot conflicts and does not provide a dedicated ownership primitive.

## 9.2 Use a dedicated Git coordination ref

Recommended:

```text
refs/coordination/claims/<TASK_ID>
```

The claim ref points to a small coordination commit containing:

```text
task id
agent id
role
base SHA
claim timestamp UTC
lease expiry UTC
protocol version
```

Example:

```text
.backlog/leases/API-142.yml
```

The commit MUST contain no production code changes.

Two agents may race.

Only one successful remote ref creation wins.

The losing agent MUST treat a rejected creation as:

```text
CLAIM_LOST
```

and immediately re-read remote state.

Git's reference update model supports atomic ref updates and conditional updates, making
refs a stronger primitive for this purpose than editing one shared Markdown row. citeturn308077search1

---

# 10. Claim algorithm

Agent:

```bash
git fetch origin --prune
git switch main
git pull --ff-only
```

Check task.

Create coordination branch/ref from current base.

Conceptual sequence:

```text
READ task
VERIFY eligibility
CREATE claim transaction
PUSH claim transaction
```

The push is the ownership race.

Success:

```text
CLAIMED
```

Reject:

```text
CLAIM_LOST
```

Never interpret local successful commit creation as successful ownership.

Only remote acceptance establishes ownership.

---

# 11. Claim transaction invariant

After successful claim:

```text
OWNER(task) == AGENT_ID
```

No other agent may transition the task to `ACTIVE`.

The owner is allowed to continue only from the claimed base SHA.

Record:

```text
BaseSHA=<sha>
```

This prevents an agent from unknowingly implementing against a moving architecture baseline.

---

# 12. Lease model

A claim is a lease, not permanent ownership.

Required fields:

```text
ClaimedUTC
LeaseUntilUTC
LastHeartbeatUTC
AgentID
BaseSHA
Branch
```

Default:

```text
lease = 24h
heartbeat = 2h
```

For long tasks, manifest may define:

```yaml
lease_hours: 72
heartbeat_hours: 6
```

A lease is valid only while evidence of activity exists.

---

# 13. Heartbeat

For long-running tasks, update:

```text
LastHeartbeatUTC
```

or produce new task-related commits.

Heartbeat MUST NOT rewrite code history.

It may update coordination metadata.

Recommended heartbeat artifact:

```text
.backlog/leases/<TASK_ID>.yml
```

A heartbeat does not transfer ownership.

---

# 14. Reclaim protocol

A task may be reclaimed only when all are true:

```text
lease expired
AND
no heartbeat during grace period
AND
no task-branch activity
AND
no open review
AND
no BLOCKED state
```

Recommended grace period:

```text
2 × heartbeat interval
```

Default example:

```text
24h lease + 4h grace
```

Before reclaim:

```bash
git fetch origin --prune
```

Then independently inspect:

```text
claim ref
task branch
commits
review status
CI status
```

Reclaim must be recorded with:

```text
RECLAIM
UTC
new agent
reason
previous owner
previous base SHA
```

Never reclaim solely because "it looks old".

---

# 15. Worktree isolation

Each active task MUST have an isolated working tree when concurrent work occurs.

Recommended:

```bash
git worktree add -b task/API-142 ../wt-API-142 main
```

Inspect:

```bash
git worktree list --porcelain
```

Git supports multiple linked worktrees attached to one repository, allowing different
branches to be checked out concurrently. citeturn308077search0

Two agents MUST NOT modify the same worktree simultaneously.

---

# 16. Environment isolation

Git isolation is insufficient.

Each parallel task SHOULD isolate:

```text
working directory
environment variables
temporary files
database
cache
message queues
ports
uploaded files
runtime storage
test fixtures
```

Preferred hierarchy:

```text
Task
 ├─ worktree
 ├─ container/process
 ├─ test DB/schema
 ├─ cache namespace
 └─ temp namespace
```

Example:

```text
DB_SCHEMA=agent_API_142
CACHE_PREFIX=agent_API_142
TMPDIR=.../API-142
PORT=18xxx
```

Never allow parallel tests to silently share mutable production-like state.

---

# 17. Database concurrency

Database schema changes are high-conflict operations.

Classify every task:

```yaml
database: false
```

or:

```yaml
database:
  schema_change: true
  migration_id: ...
```

Rules:

### Parallel-safe

Read-only queries, isolated test schemas, additive application code.

### Serialized

- destructive migrations;
- column renames;
- table drops;
- incompatible indexes;
- data migrations;
- global seed changes;
- shared test DB mutations.

Migration tasks MUST declare explicit dependencies.

Example:

```yaml
depends_on:
  - DB-041
```

Never permit two agents to independently mutate the same production schema version.

---

# 18. Path ownership

Large repositories need path-level conflict control.

Task manifests SHOULD declare:

```yaml
paths:
  - app/Auth/**
  - tests/Auth/**

exclusive_paths:
  - database/migrations/**
```

Two `ACTIVE` tasks MUST NOT own overlapping `exclusive_paths`.

For non-exclusive paths, overlap is permitted only if:

```text
semantic conflict risk = acceptable
AND
both owners are aware
```

Generated files SHOULD be treated as derived artifacts, not shared hand-edited sources.

---

# 19. Protected files

Recommended protected paths:

```text
.github/workflows/**
CODEOWNERS
MULTI-AGENT.md
specs/architecture/**
specs/security/**
database/migrations/**
deploy/**
production configuration
```

Path protection may require Master or designated CODEOWNER review.

Repository-native branch protection remains authoritative.

---

# 20. Gate 0 — Understand

Before coding:

```text
[ ] task manifest read
[ ] acceptance criteria understood
[ ] dependencies verified
[ ] path ownership checked
[ ] architecture impact checked
[ ] security impact checked
[ ] deployment impact checked
[ ] database impact classified
```

If the task is ambiguous:

```text
BLOCKED
```

Do not silently invent requirements.

---

# 21. Gate 1 — Inspect

Run:

```bash
git status --short --branch
git log --oneline --decorate -20
git diff
```

For affected files:

```bash
git log --follow -- <file>
```

Search call sites before modifying:

```text
API
schema
config
authentication
serialization
public interfaces
database contracts
```

---

# 22. Gate 2 — Test

For behavioral changes:

```text
RED → IMPLEMENT → GREEN
```

The first test SHOULD fail for the intended reason.

Record:

```text
Test:
Expected:
Observed:
```

For mechanical/documentation-only changes, replace RED/GREEN with deterministic validation.

Examples:

```text
schema validator
markdown linter
configuration parser
snapshot comparison
build
```

---

# 23. Gate 3 — Implementation

Implementation MUST be:

```text
minimal
scoped
backward-compatible unless explicitly breaking
test-backed
reversible
```

Avoid unrelated cleanup.

An agent that discovers unrelated defects creates a separate task.

---

# 24. Gate 4 — Verification

At minimum:

```bash
git diff --check
```

Then all affected checks:

```text
unit
integration
static analysis
lint
build
security
configuration validation
```

Never replace execution with statements such as:

```text
"tests should pass"
```

Record actual results.

---

# 25. Deterministic build principle

A build must be reproducible from:

```text
commit SHA
lockfiles
declared toolchain
declared configuration
```

Avoid relying on mutable:

```text
latest
current
floating dependency
unrecorded local package
```

For production artifacts record:

```text
SOURCE_SHA
BUILD_ID
TOOLCHAIN_VERSION
ARTIFACT_DIGEST
```

---

# 26. Review architecture

Review is not merely "another agent looked at the diff".

Review MUST be independent in context.

Preferred:

```text
implementation agent
        ↓
fresh review context
        ↓
review findings
        ↓
implementation agent
        ↓
fresh review
```

For critical changes use:

```text
two independent reviewers
```

Critical examples:

```text
authentication
authorization
payments
cryptography
database destruction
production deployment
security controls
data deletion
```

---

# 27. Review categories

Reviewer MUST inspect:

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

Reviewers should actively seek:

```text
race conditions
TOCTOU
idempotency defects
partial failure
retry amplification
stale state
privilege escalation
secret leakage
silent data loss
```

---

# 28. Review output

Store:

```text
.backlog/reviews/<TASK_ID>/<ITERATION>.md
```

Example:

```md
# Review API-142 / iteration 1

Base: abc123
Head: def456

Decision: FAIL

## Critical
...

## High
...

## Medium
...

## Low
...

## Required changes
...

Reviewer: claude-b912
```

A review cannot be replaced by a chat message.

---

# 29. Review loop

Default maximum:

```text
3 iterations
```

After the third failed iteration:

```text
BLOCKED
```

Create:

```text
.backlog/decisions/<TASK_ID>-halt.md
```

Contain:

```text
problem
attempts
evidence
remaining uncertainty
risk
recommended decision
```

A task MUST NOT mutate indefinitely just to obtain a PASS.

---

# 30. Handoff contract

A handoff MUST contain:

```text
TASK_ID
STATE
OWNER
BASE_SHA
HEAD_SHA
BRANCH
CHANGED_AREAS
TESTS
REVIEW
KNOWN_RISKS
OPEN_QUESTIONS
NEXT_ACTION
```

Example:

```text
TASK_ID=API-142
STATE=REVIEW
OWNER=claude-a17f
BASE_SHA=abc123
HEAD_SHA=def456
BRANCH=task/API-142
TESTS=PASS
REVIEW=.backlog/reviews/API-142/2.md
RISK=MEDIUM
NEXT_ACTION=Master review/integrate
```

---

# 31. Commit protocol

Format:

```text
<type>(<scope>): <summary>
```

Allowed types:

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

Every task commit SHOULD contain:

```text
Task: <TASK_ID>
```

Example:

```text
fix(auth): rotate session identifier after login

Task: SEC-021
```

Atomic commits are preferred.

---

# 32. Branch model

Implementation:

```text
task/<TASK_ID>
```

Hotfix:

```text
hotfix/<TASK_ID>
```

Release:

```text
release/<VERSION>
```

Do not implement features directly on `main`.

---

# 33. Rebase policy

Before integration:

```bash
git fetch origin
git rebase origin/main
```

If rebase changes semantic behavior:

```text
rerun relevant tests
repeat review when review scope changed materially
```

Do not assume an unchanged final diff means an unchanged review context.

---

# 34. Conflict handling

A textual conflict is not necessarily a semantic conflict.

On conflict:

```text
STOP
INSPECT
UNDERSTAND BOTH INTENTS
RESOLVE
TEST
REVIEW
```

Never solve conflicts by blindly choosing:

```text
ours
theirs
latest
```

For architecture ambiguity:

```text
BLOCKED
```

and require Master/design authority.

---

# 35. Merge policy

## Master

Master may integrate only when:

```text
task == APPROVED
required tests == PASS
required reviews == PASS
CI == PASS
working state == known
branch == current
no unresolved conflict
security gates == PASS
```

Preferred integration:

```text
Pull Request
→ required checks
→ required reviewers
→ merge queue
→ main
```

Protected branches can enforce required status checks before merge; repository policy should be used rather than relying only on agent behavior. citeturn308077search9

## Slave

Slave:

```text
push branch
set REVIEW
publish handoff
STOP
```

---

# 36. Merge queue principle

For repositories with multiple concurrent branches, use merge queue where available.

Why:

```text
PR A tested against main N
PR B tested against main N
A merges
B's previous green state is no longer sufficient
```

A merge queue revalidates integration order against the evolving target branch.

Never interpret:

```text
CI green on old main
```

as:

```text
green after integration
```

---

# 37. TOCTOU protection

Tasks involving:

```text
permissions
security
filesystem
deployment
schema
configuration
resource allocation
```

must consider time-of-check/time-of-use races.

Pattern:

```text
CHECK
→ STATE MAY CHANGE
→ ACT
```

must be replaced where possible by:

```text
ATOMIC OPERATION
```

or:

```text
CHECK + VERSION/LOCK + ACT
```

or:

```text
TRANSACTION
```

---

# 38. Optimistic concurrency

When a resource supports versioning:

```text
READ version N
MODIFY expecting N
COMMIT only if version still N
```

On mismatch:

```text
retry/reconcile
```

not:

```text
overwrite
```

Git's conditional ref update mechanism is an example of this pattern. citeturn308077search1

---

# 39. Idempotency

Automation should make repeated execution safe.

Examples:

```text
deploy twice
retry API request
rerun migration command
restart worker
repeat cleanup
```

must not unexpectedly duplicate or destroy state.

For externally visible operations prefer:

```text
idempotency key
```

when supported.

---

# 40. Retry policy

Never implement blind infinite retries.

Use:

```text
bounded retries
exponential backoff
jitter
classification of retryable errors
```

Distinguish:

```text
transient
permanent
unknown
```

Unknown errors should generally fail closed.

---

# 41. Distributed-work principle

An agent operation must have an explicit failure boundary.

For every significant action ask:

```text
What if process dies here?
What if network dies here?
What if another agent changes the resource here?
What if command succeeds but response is lost?
What if it runs twice?
What if state is partially updated?
```

The answer must be encoded in the task implementation or operational procedure.

---

# 42. Artifact integrity

Important generated artifacts SHOULD be addressed by digest:

```text
SHA-256
```

Record:

```text
artifact
digest
source SHA
build ID
```

Never trust only filenames.

Example:

```text
artifact.zip
sha256=...
source=def456
```

---

# 43. Secret handling

Never commit:

```text
.env
deploy.env
credentials
tokens
private keys
certificates
production dumps
session cookies
```

Production configuration remains external to Git.

Add CI secret scanning where available.

Before commit:

```bash
git diff --cached
git status --ignored
```

Before integration:

```text
secret scan
```

is required for protected repositories.

---

# 44. Security baseline

For web applications, security behavior is part of acceptance criteria.

Examples:

```text
authenticated endpoints require authentication
authorization is server-side
internal files are not public
debug output is disabled in production
cookies use required security attributes
secrets do not enter logs
```

Never accept a test suite that simply omits security behavior.

---

# 45. Local/production parity

Where production uses a specific routing/security layer, local verification must test the effective behavior.

For PHP deployments where `.htaccess` semantics are involved:

```text
local router behavior
AND
production HTTP behavior
```

must be treated as separate test targets.

The project deployment evidence shows that `pro.telezip.net` presents `nginx` while `.htaccess` behavior is nevertheless observed behind the serving stack; therefore HTTP smoke tests are required rather than assuming the server topology from one header alone. fileciteturn1file1L158-L164

---

# 46. Deployment is a privileged state transition

Never equate:

```text
MERGED
```

with:

```text
DEPLOYED
```

Production deployment requires:

```text
explicit authorization
known source SHA
clean build
deployment plan/dry-run
transport security
deployment execution
runtime validation
rollback target
```

---

# 47. Deployment transaction

Preferred model:

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
```

If any critical verification fails:

```text
STOP
ROLLBACK or HOLD
```

Do not continue unrelated deployments.

---

# 48. Deployment path safety

Never assume that:

```text
server filesystem path
=
FTP account-relative path
```

Validate the actual account root.

For the current pro.telezip.net deployment, evidence established that the FTP account root already maps to the intended document root and the correct `FTP_PATH` is `/`; using the server's absolute filesystem path as the FTP-relative path created a nested, incorrect deployment tree. fileciteturn1file1L140-L156

Project-specific deployment facts MUST remain project-specific.

Do not copy them blindly to another repository.

---

# 49. Production smoke tests

At minimum test:

```text
health
routing
authentication
critical API
security boundaries
static assets
```

For the current project, verified expected behavior includes:

```text
/api/health → 200
/api/does-not-exist → 404 JSON
internal paths → 403
```

and internal paths include:

```text
/.env
/app/Bootstrap.php
/vendor/autoload.php
```

These are deployment-specific acceptance checks. fileciteturn1file1L219-L235

---

# 50. Rollback contract

Every production release MUST have:

```text
known-good SHA
artifact digest
deployment timestamp
rollback procedure
```

Rollback target must be explicit.

Never say:

```text
"rollback to previous version"
```

without defining what that version actually is.

---

# 51. Observability

Changes affecting production behavior SHOULD define:

```text
logs
metrics
errors
latency
health
alerts
```

A feature that cannot be diagnosed in production is operationally incomplete.

Critical operations should have correlation identifiers where practical.

---

# 52. Data safety

Tasks touching user or production data must define:

```text
read scope
write scope
backup/recovery
rollback
retention
validation
```

Destructive operations require explicit confirmation in task acceptance criteria.

For bulk mutation:

```text
dry-run
→ sample validation
→ bounded execution
→ post-check
```

---

# 53. Human-in-the-loop boundary

The protocol SHOULD require human authorization for:

```text
production deploy
production data modification
destructive schema changes
credential rotation
security-policy relaxation
branch-protection changes
irreversible operations
```

Automation can prepare the operation.

Authorization approves the state transition.

---

# 54. Capability matrix

Recommended task metadata:

```yaml
capabilities_required:
  - CODE
  - TEST
```

Sensitive examples:

```yaml
capabilities_required:
  - CODE
  - SECURITY
  - DEPLOY
```

Agent without required capability MUST NOT perform the task.

Role alone does not imply every capability.

---

# 55. Exclusive operations

Some operations are globally serialized.

Examples:

```text
production deployment
release tagging
database destructive migration
credential rotation
schema cutover
DNS changes
branch protection changes
```

These use:

```text
exclusive operation lock
```

and MUST NOT be parallelized.

---

# 56. Safe parallelism

Parallelize:

```text
independent features
independent tests
documentation
static analysis
read-only investigation
isolated migrations
```

Serialize:

```text
shared mutable state
same exclusive path
same schema transition
same production environment
same release version
```

The goal is not maximum concurrency.

The goal is:

```text
maximum SAFE concurrency
```

---

# 57. Main branch invariants

`main` MUST satisfy:

```text
buildable
testable
deployable according to repository policy
no unresolved task state
no known secrets
no unreviewed protected-path changes
```

Never use `main` as a temporary shared workbench.

---

# 58. Protected branch policy

Recommended for production repositories:

```text
require_pull_request = true
require_status_checks = true
require_review = true
dismiss_stale_reviews = true
require_code_owner_review = true for critical paths
force_push = false
direct_push = false for agents
```

Where supported:

```text
merge_queue = true
linear_history = true
```

GitHub, for example, supports required status checks as part of protected branch policy. citeturn308077search9

---

# 59. Hooks and CI

Hooks and CI are protocol gates.

Forbidden by default:

```bash
git commit --no-verify
git push --force
git push --force origin main
```

A local check may be bypassed only when repository policy explicitly permits it and an equivalent authoritative CI gate still exists.

The agent MUST NOT disable the gate merely to unblock itself.

---

# 60. Machine-enforceable policy

A repository SHOULD provide:

```text
bin/agentctl
bin/agentctl.ps1
```

with commands conceptually equivalent to:

```text
agentctl doctor
agentctl task list
agentctl task validate <ID>
agentctl task claim <ID>
agentctl task heartbeat <ID>
agentctl task release <ID>
agentctl task status <ID>
agentctl task handoff <ID>
agentctl review validate <ID>
agentctl merge validate <ID>
agentctl deploy plan
agentctl deploy verify
```

The Markdown describes the contract.

The scripts enforce the contract.

Manual policy without enforcement should be treated as weaker than CI-enforced policy.

---

# 61. Doctor command

`agentctl doctor` SHOULD verify:

```text
git version
git repository
remote connectivity
clean/known workspace
current branch
origin state
worktree state
agent identity
role
required tools
required test commands
secrets safety
coordination state
```

Output:

```text
PASS / WARN / FAIL
```

Do not continue on critical `FAIL`.

---

# 62. Task validation

Before claim:

```text
agentctl task validate <TASK_ID>
```

MUST verify:

```text
task exists
state == TODO
dependencies satisfied
no claim
path ownership valid
required capability present
```

---

# 63. Claim validation

`agentctl task claim <TASK_ID>` SHOULD:

```text
fetch
validate
create isolated claim
publish claim atomically
verify remote ownership
```

The command MUST fail if another owner wins the race.

A local success message is insufficient.

---

# 64. Release

Normal release:

```text
REVIEW → APPROVED → INTEGRATED → DONE
```

Claim release before completion is allowed only for:

```text
BLOCKED
ABANDONED
handoff
```

The next agent must receive a complete handoff.

---

# 65. Abandonment

When abandoning work:

```text
state = ABANDONED
```

record:

```text
reason
latest SHA
test status
known risks
recovery notes
```

Never silently delete a task branch containing important work.

---

# 66. Recovery after agent crash

If an agent disappears:

1. Inspect claim.
2. Inspect lease.
3. Inspect task branch.
4. Inspect commits.
5. Inspect CI/review.
6. Determine whether work is recoverable.
7. Reclaim only after lease rules.
8. Preserve existing commits.

Recovery MUST NOT assume that an abandoned process means abandoned work.

---

# 67. Recovery after remote outage

If origin is unavailable:

```text
do not fabricate claim ownership
do not advertise CLAIMED as authoritative
do not modify another task
```

Local work may continue only if:

```text
task was already authoritatively claimed
```

Otherwise wait for connectivity or switch to independent read-only work.

---

# 68. Recovery after corrupted coordination state

If task metadata is inconsistent:

```text
Git refs/history first
then task artifacts
then metadata repair
```

Repair must itself be committed.

Never silently rewrite history to hide coordination errors.

---

# 69. BACKLOG.md policy

`BACKLOG.md` is optional human-facing index.

It may summarize:

```text
TODO
CLAIMED
ACTIVE
REVIEW
DONE
```

But authoritative ownership should come from:

```text
coordination refs + task manifests + Git history
```

This prevents a large shared Markdown table from becoming the primary concurrency hotspot.

---

# 70. Architecture decision records

For significant architectural decisions use:

```text
specs/architecture/ADR-<NNN>-<slug>.md
```

Minimum:

```text
Context
Decision
Alternatives
Consequences
Rejected options
Migration/rollback
```

Master or designated architecture owner approves.

---

# 71. Change classification

Every task SHOULD have:

```text
risk = LOW | MEDIUM | HIGH | CRITICAL
```

Suggested interpretation:

```text
LOW
  docs, isolated tests, trivial UI/text

MEDIUM
  local code behavior, noncritical API

HIGH
  auth, database, infrastructure, security-sensitive code

CRITICAL
  production access, destructive data operations, credentials,
  release infrastructure, security boundary changes
```

Higher risk increases:

```text
review count
test scope
authorization
deployment controls
```

---

# 72. Risk-adaptive review

Recommended:

```text
LOW       → 1 review
MEDIUM    → 1 independent review
HIGH      → 2 independent reviews or designated expert
CRITICAL  → owner + security/architecture review + CI
```

Repository may increase these requirements.

Never reduce a required review merely to unblock throughput.

---

# 73. Generated files

Generated artifacts SHOULD be classified:

```text
SOURCE
DERIVED
BUILD
RUNTIME
```

Only source files should normally be hand-edited.

Examples:

```text
vendor/      → generated/dependency
dist/        → build artifact
storage/     → runtime
.env         → runtime secret
```

Task manifests MUST identify whether generated output is expected.

---

# 74. Dependency updates

Dependency changes require:

```text
lockfile update
compatibility tests
security scan
license/policy validation where applicable
```

Avoid mixing dependency upgrades with unrelated feature work unless required.

---

# 75. API/schema changes

For public contracts:

```text
producer
consumer
compatibility
migration
rollback
```

must be evaluated together.

Prefer:

```text
add new
migrate consumers
deprecate old
remove later
```

over:

```text
break immediately
```

unless explicitly required.

---

# 76. Configuration changes

Every configuration change must define:

```text
default
production value source
backward compatibility
validation
failure behavior
secret classification
```

Never silently change security-sensitive defaults.

---

# 77. Testing database / migrations

Test DB strategy SHOULD be:

```text
one isolated schema/container per task
```

not:

```text
one mutable shared DB for all agents
```

For SQLite/in-memory tests, confirm that semantics match production for affected behavior.

Do not use SQLite as evidence for PostgreSQL/MySQL-specific behavior without an integration test against the actual engine.

---

# 78. HTTP integration testing

For web routing/security changes, use real HTTP requests.

Example:

```text
GET /api/health
GET /api/does-not-exist
GET /.env
GET /app/Bootstrap.php
GET /vendor/autoload.php
```

Validate:

```text
status
headers
content type
body shape
security behavior
```

For the current project, the deployment procedure explicitly requires an HTTP-level check because local PHP's built-in server does not read `.htaccess`; `bin/router.php` reproduces those rules locally. fileciteturn1file1L237-L248

---

# 79. Deployment configuration safety

For projects using FTP/FTPS:

```text
transport must be encrypted
remote path must be validated
dry-run must precede execute
```

Never silently downgrade secure transport.

The current project deployment script requires FTPS and intentionally fails rather than sending credentials without TLS. fileciteturn1file1L200-L211

---

# 80. Production secret separation

Production `.env` belongs to runtime.

Repository SHOULD contain:

```text
.env.example
```

but not:

```text
.env
```

The current project follows this model and explicitly excludes production `.env` and runtime storage from deployment artifacts. fileciteturn1file1L213-L217

---

# 81. Final task state

`DONE` requires:

```text
[ ] acceptance criteria satisfied
[ ] dependencies satisfied
[ ] implementation complete
[ ] tests PASS
[ ] static checks PASS
[ ] security checks PASS when applicable
[ ] review PASS
[ ] review artifact committed
[ ] branch integrated
[ ] final SHA recorded
[ ] coordination state consistent
```

Deployment tasks additionally require:

```text
[ ] build identified
[ ] artifact digest recorded
[ ] authorization recorded
[ ] dry-run PASS
[ ] deployment PASS
[ ] runtime health PASS
[ ] smoke tests PASS
[ ] rollback target recorded
```

---

# 82. Formal invariants

The following invariants MUST remain true.

## I1 — Single ownership

```text
ACTIVE(T) → exactly one owner
```

## I2 — Isolated execution

```text
ACTIVE(T) → isolated worktree/environment
```

when parallel work exists.

## I3 — No unreviewed integration

```text
main ← only approved changes
```

## I4 — No implicit deployment

```text
merge ≠ deploy
```

## I5 — No unknown security state

```text
security uncertainty → STOP
```

## I6 — No hidden mutable state

Important runtime coordination must be observable in repository/CI/runtime evidence.

## I7 — Reproducibility

```text
artifact → source SHA + build identity
```

## I8 — Safe recovery

An agent crash must not destroy committed work.

---

# 83. Agent startup procedure

Execute conceptually:

```text
1. identify AGENT_ID
2. identify ROLE
3. run agentctl doctor
4. fetch origin
5. inspect worktrees
6. inspect task manifests
7. inspect claims
8. inspect dependencies
9. choose eligible task
10. claim atomically
11. verify remote ownership
12. create worktree
13. begin Gate 0
```

---

# 84. Agent completion procedure

Execute:

```text
1. verify clean/known state
2. run all required tests
3. run security checks
4. create review artifact
5. pass independent review
6. update handoff
7. push branch
8. transition to REVIEW
9. stop unless authorized to integrate
```

---

# 85. Master integration procedure

Execute:

```text
1. fetch origin
2. verify task ownership/state
3. verify review
4. verify CI
5. verify branch freshness
6. inspect final diff
7. integrate through protected mechanism
8. verify resulting main
9. record final SHA
10. transition task to INTEGRATED/DONE
```

---

# 86. Master deployment procedure

Only when explicitly authorized:

```text
1. identify exact SHA
2. build exact SHA
3. verify artifact
4. run dry-run
5. verify remote target
6. execute deployment
7. run health
8. run smoke tests
9. inspect logs/metrics
10. record deployment
11. retain rollback target
```

---

# 87. Emergency procedure

Emergency mode is limited to:

```text
outage
security incident
data corruption
critical production failure
```

Process:

```text
FREEZE NORMAL WORK
→ IDENTIFY INCIDENT
→ CREATE HOTFIX
→ MINIMIZE CHANGE
→ TEST
→ REVIEW WHEN POSSIBLE
→ AUTHORIZE
→ DEPLOY
→ VERIFY
→ DOCUMENT
```

Emergency does not mean:

```text
ignore history
delete evidence
force-push casually
disable all security
```

---

# 88. Anti-patterns

Forbidden:

```text
shared mutable worktree
chat-only claim
local-only claim
shared database without isolation
blind merge conflict resolution
blind retries
infinite review loop
deploy because "main changed"
claim because "nobody answered"
force-push to win ownership
secret in repository
unrecorded production change
```

---

# 89. Scalability model

The protocol is designed to scale from:

```text
1 agent
```

to:

```text
N agents
```

without changing the fundamental contract.

Scaling should increase:

```text
branches
worktrees
review queue
CI load
```

not:

```text
race conditions
shared mutable state
uncertain ownership
```

The system optimizes for:

```text
safe concurrency
```

rather than:

```text
raw concurrency
```

---

# 90. Compatibility modes

## Mode A — Full

```text
task manifests
coordination refs
agentctl
worktrees
CI
protected main
review
merge queue
deployment gates
```

## Mode B — Git-only

Minimum:

```text
task manifests
coordination refs
task branches
review artifacts
```

## Mode C — Legacy fallback

Only if infrastructure cannot yet support coordination refs:

```text
BACKLOG.md
atomic push
task branches
review artifacts
```

Mode C is compatibility fallback, not the preferred architecture.

---

# 91. Migration from the legacy protocol

Existing repositories using one shared `BACKLOG.md` may migrate incrementally:

```text
Phase 1
BACKLOG.md remains human index

Phase 2
create .backlog/tasks/

Phase 3
move ownership to coordination refs

Phase 4
add agentctl validation

Phase 5
protect main

Phase 6
enable CI/review/merge queue

Phase 7
enforce policy automatically
```

Do not perform a destructive migration in one step while agents are actively working.

---

# 92. Protocol versioning

Changes to this document require review.

Version semantics:

```text
MAJOR = state/authority/coordination semantics change
MINOR = new capability or optional enforcement
PATCH = clarification/no behavior change
```

Examples:

```text
docs(protocol): clarify reclaim semantics
chore(protocol): add heartbeat support
feat(protocol): add atomic claim refs
```

---

# 93. Golden invariant

The protocol MUST always preserve this:

```text
No agent may perform a consequential operation whose ownership,
preconditions, result, or recovery state cannot be established
from durable evidence.
```

Durable evidence is one or more of:

```text
Git ref
Git commit
task manifest
review artifact
CI result
deployment record
runtime verification
```

Chat is not durable evidence.

---

# 94. Golden flow

```text
DISCOVER
   ↓
VALIDATE
   ↓
CLAIM
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

Any critical failure transitions to:

```text
STOP / BLOCK / ROLLBACK
```

not silent continuation.

---

# 95. Project-specific boundary

This protocol is universal.

Project-specific facts MUST remain outside its universal invariants.

For pro.telezip.net, for example:

```text
FTP_PATH=/
FTPS required
/api/health → 200
internal files → 403
production .env external to Git
site/storage external to deploy source
```

are deployment facts for that project, supported by deployment evidence. fileciteturn1file1L154-L164 fileciteturn1file1L211-L217

They are not assumptions that should be copied into another repository.

---

# 96. Final operational law

```text
AUTHORITY is not QUALITY.
CLAIM is not IMPLEMENTATION.
IMPLEMENTATION is not VERIFICATION.
VERIFICATION is not APPROVAL.
APPROVAL is not INTEGRATION.
INTEGRATION is not DEPLOYMENT.
DEPLOYMENT is not HEALTH.
```

Each state transition requires its own evidence.

**Master and Slave use this same protocol.**

The difference is only which transitions each role is authorized to perform.
