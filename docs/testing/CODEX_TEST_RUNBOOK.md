# Codex repository test Runbook

Protocol version: **1.1.0**

This file is the execution authority for repository-owned validation. Codex is the executor, not the test designer. Do not change the test method during a run.

## 1. Purpose

The active profile `repository-exact-head-validation` verifies that the exact Git commit selected by `ACTIVE_TEST.json` is reachable, reproducible, buildable, test-clean, and consistent with the current Native-first ownership boundary.

This profile is a correctness/architecture gate. It is **not** a latency or throughput benchmark. Commands intentionally run in parallel where safe, so their wall-clock times must not be interpreted as product performance measurements.

The protocol also defines how repository activity may continue while a test is running and how non-blocking tests are retained for later execution.

## 2. Authority, control-plane freeze, and immutable inputs

Before running target commands, read these files from one bootstrap checkout commit:

1. `/AGENTS.md`
2. `/docs/testing/ACTIVE_TEST.json`
3. `/docs/testing/DEFERRED_TESTS.json`
4. `/docs/testing/CODEX_TEST_RUNBOOK.md`
5. `/docs/testing/CODEX_AGENT_PLAN.md`
6. `/docs/testing/TEST_RESULT_SCHEMA.json`

### 2.1 Freeze the control plane

Coordinator records:

```text
git rev-parse HEAD
```

Call this immutable value `controlPlaneCommit`.

Before target execution, copy the six protocol files listed above into the external evidence directory under `bootstrap/control-plane/` and record the Git object id for each file as observed at `controlPlaneCommit`.

Recommended non-destructive Git identity operation for each file:

```text
git rev-parse <controlPlaneCommit>:<repository-relative-path>
```

After this snapshot is complete:

- do not pull, checkout, or switch the bootstrap worktree to obtain newer protocol files;
- do not reread `ACTIVE_TEST.json` or the Runbook from a moving remote ref;
- do not let a later repository update alter the run's commands, agent plan, target, or verdict rules;
- use only the frozen snapshot for the remainder of the run.

If the control-plane files cannot all be read from one commit, verdict = `BLOCKED`.

### 2.2 Immutable active inputs

The following fields from the frozen `ACTIVE_TEST.json` are immutable for the run:

- `repository`
- `testId`
- `profile`
- `executionClass`
- `blocksMainline`
- `target.branch`
- `target.commit`
- `targetPolicy.*`
- `protocol.version`
- protocol file paths

Do not replace a missing or inaccessible value with a guessed value.

## 3. Repository-concurrency semantics

Repository updates during a Codex test are allowed under these rules.

### 3.1 Updates that do not corrupt a running test

After `controlPlaneCommit` is frozen and barrier `B0_TARGET_PINNED` is reached, later pushes to GitHub do not change the already-running test because:

- protocol inputs come from the frozen control-plane snapshot;
- product/test execution happens in a detached worktree at the exact target SHA;
- the original worktree is never switched or reset;
- results are scoped to the exact tested SHA.

Development may therefore continue on other branches while Codex tests the pinned target.

### 3.2 Blocking target moved during the run

A blocking test has two separate questions:

1. **Did the exact tested commit pass?**
2. **Does that result still satisfy the current mainline gate?**

If the target branch advances after `B0_TARGET_PINNED`, continue the exact-SHA run. Do not restart automatically and do not alter the target.

At completion, perform the freshness check in Section 10.

If the branch no longer points to the tested commit:

- the exact-commit verdict remains valid historical evidence;
- `mainlineGate.status` MUST be `STALE`;
- `mainlineGate.satisfied` MUST be `false`;
- a PASS MUST NOT be used to unblock the newer head;
- do not auto-run the newer head unless a new active-test snapshot authorizes it.

### 3.3 Non-blocking/deferred tests

Deferred tests do not block mainline progress. Their definitions live in `DEFERRED_TESTS.json`.

A deferred result always applies only to its bound exact execution target.

Two replay modes are permitted when an entry is executable:

- **historical replay** — run the original retained exact target and preserve the result as historical evidence;
- **forward validation** — bind a new exact target for current code while retaining the original registration context. A newer run is a new execution record; it does not overwrite the historical run.

Never reinterpret an old PASS as proof for a newer commit.

## 4. Hard prohibitions

During this protocol the executor and every subagent MUST NOT:

- merge any pull request;
- push any commit or tag;
- force-push or move a remote ref;
- delete a branch;
- change repository settings;
- run `git reset --hard` on the user's existing worktree;
- run `git clean` on the user's existing worktree;
- discard, stash, amend, or commit the user's local changes;
- edit production source to make a test pass;
- edit tests to make a test pass;
- change model/configuration/test inputs during the run;
- silently skip a required command;
- retry a deterministic failure unless this Runbook explicitly permits that retry;
- treat historical CI or historical deferred results as current PASS evidence;
- switch protocol versions or target SHAs after the control-plane freeze.

If a required step cannot be executed under these rules, return `BLOCKED` or `INCONCLUSIVE` according to Section 12.

## 5. Evidence location

Create a run identifier:

```text
<testId>-<UTC timestamp>-<short target SHA>
```

Create evidence outside every Git worktree, for example:

```text
<OS temp>/codex-workbench-tests/<run-id>/
  bootstrap/
    repository.txt
    control-plane/
    file-object-ids.json
  environment/
  install/
  ownership-audit/
  typecheck/
  tests/
  build/
  freshness/
  review/
  result.json
```

Every command record must contain:

- command or operation description;
- working directory;
- start timestamp UTC;
- end timestamp UTC;
- exit code when applicable;
- stdout path;
- stderr path;
- executor/agent id.

Evidence is immutable input to the final reviewer. Do not rewrite failed command output after later steps succeed.

## 6. Phase 0 — Bootstrap identity and target resolution

Coordinator only.

### 6.1 Record original repository identity

From the repository supplied by the user, record without modifying it:

```text
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1
```

A dirty original worktree is allowed. Record it; do not alter it.

The `git rev-parse HEAD` used for the frozen control plane must match the recorded `controlPlaneCommit`.

### 6.2 Validate repository identity

The origin must resolve to the repository named by frozen `ACTIVE_TEST.json` or an equivalent authenticated GitHub URL for that exact repository.

If it refers to another repository, verdict = `BLOCKED`.

### 6.3 Fetch and validate the declared blocking target

Fetch only what is required to resolve the declared target. Do not update the current working branch.

Required logical operation:

```text
git fetch --no-tags origin <target.branch>
```

Resolve the fetched branch head and compare it with `target.commit`.

For `targetPolicy.startFreshness = branch-head-must-match`:

- equal -> continue;
- branch does not exist / commit inaccessible -> `BLOCKED`;
- branch exists but head != configured commit -> `BLOCKED` with reason `ACTIVE_TEST_STALE`.

This start-time stale check prevents beginning a blocking gate against a target already superseded before execution.

### 6.4 Create isolated target worktree

Create a detached Git worktree in a temporary directory at exactly `target.commit`:

```text
git worktree add --detach <temporary-target-worktree> <target.commit>
```

Inside it verify:

```text
git rev-parse HEAD
git status --porcelain=v1
```

Required:

- HEAD exactly equals `target.commit`;
- target worktree initially has no tracked or untracked changes.

If not, `BLOCKED`.

Record the start branch head in result field `target.observedBranchHeadAtStart`.

This completes barrier **B0_TARGET_PINNED**.

## 7. Phase 1 — Environment and dependency preparation

After `B0_TARGET_PINNED`, execute Wave 1 from `CODEX_AGENT_PLAN.md`.

### 7.1 Environment evidence

Capture at minimum:

```text
git --version
node --version
npm --version
```

Also record OS/platform and CPU architecture using a non-destructive platform command.

Do not reject an environment merely because its version differs from historical evidence unless repository constraints require a different version or a command demonstrably fails because of incompatibility.

### 7.2 Dependency installation

Coordinator runs in the detached target worktree:

```text
npm ci
```

Allowed retry policy:

- at most **one** retry;
- only if the first failure is clearly an external package-registry/network transport failure;
- never retry dependency-resolution errors, lifecycle-script failures, integrity failures, source errors, or test errors;
- preserve first-attempt evidence;
- record retry as a separate command record.

If install still cannot complete because of external infrastructure -> `INCONCLUSIVE`.

If install fails deterministically because of repository/dependency state -> `FAIL`.

Success completes **B1_DEPENDENCIES_READY**.

## 8. Phase 2 — Native ownership static audit

This may begin after `B0_TARGET_PINNED` and may run in parallel with `npm ci`.

Search all production source under `src/` for at least:

```text
new AppServerProcessClient
new NativeThreadRuntime
startAndInitializeAppServerClient
thread/start
turn/start
runCompatibilityFallback
runCompatibilityMaintenance
fallbackScopes
fallbackPatchedProjects
```

Inventory each occurrence with:

- file path;
- line;
- containing class/function;
- ownership classification;
- reason the occurrence is allowed or violating.

Allowed ownership rules:

1. Codex Native runtime/host adapters may own App Server process/client transport where they are the actual runtime owner.
2. Workbench Map coordinators must not create a second direct App Server client/process merely for compatibility fallback or reads.
3. Conversation Map must not own an independent fallback Native runtime for maintenance.
4. Project Map may own its single dedicated maintenance `NativeThreadRuntime` where dynamic-tools registration requires a fresh Native thread; that runtime must not coexist with an extra direct App Server compatibility fallback.
5. Project Map context/read gathering must use the shared/registered Native read boundary rather than create per-read App Server process ownership.
6. Workbench must not introduce a second transcript, sandbox, tool executor, subagent runtime, or context manager.

Focused files include, when present:

- `src/codex/native-thread-runtime.ts`
- `src/codex/app-server-host.ts`
- `src/main/project-map-manager.ts`
- `src/main/map-coordinator.ts`

Also search the rest of `src/`.

Required output:

```text
second_app_server_owner_detected: true|false
conversation_map_fallback_runtime_detected: true|false
project_map_direct_compat_fallback_detected: true|false
per_read_app_server_owner_detected: true|false
duplicate_transcript_or_tool_runtime_detected: true|false
unclassified_occurrence_count: <integer>
```

Any unclassified production ownership occurrence is an audit failure. Do not edit it.

## 9. Phase 3 — Parallel correctness gates

After `B1_DEPENDENCIES_READY`, start the following simultaneously unless a hard resource/safety limit requires recorded serialization.

### Gate C — Typecheck

```text
npm run typecheck
```

No retry for non-zero exit.

### Gate D — Full repository tests

```text
npm test
```

No retry for non-zero exit. Do not replace with a targeted subset.

### Gate E — Build

```text
npm run build
```

No retry for non-zero exit.

Build may create ordinary ignored/generated output. Source/test/protocol edits are forbidden.

After all three terminate, complete **B2_CORRECTNESS_GATES_DONE**.

## 10. Phase 4 — Integrity and completion freshness

### 10.1 Post-run worktree integrity

Coordinator records in the target worktree:

```text
git status --porcelain=v1
git diff --name-status
git diff --cached --name-status
```

Interpretation:

- ignored/generated output from ordinary install/build is allowed;
- any tracked source, test, protocol, package manifest, lockfile, or configuration mutation caused by the run is a protocol failure unless the repository explicitly declares that command as the generator;
- never erase tracked changes before recording them.

### 10.2 Completion branch freshness

For a blocking active test whose completion policy is `branch-head-must-match-for-mainline-gate`, fetch/resolve the target branch again without modifying the tested worktree.

Record the observed end head as `target.observedBranchHeadAtCompletion`.

Do **not** change the tested commit.

Set `mainlineGate` mechanically:

- if execution class is non-blocking -> `status = NOT_APPLICABLE`, `satisfied = false`;
- if the run could not establish a valid tested target -> `status = BLOCKED`, `satisfied = false`;
- if end branch head != tested commit -> `status = STALE`, `satisfied = false`;
- if end branch head == tested commit and exact-commit verdict is PASS -> `status = SATISFIED`, `satisfied = true`;
- if end branch head == tested commit and exact-commit verdict is FAIL -> `status = FAILED`, `satisfied = false`;
- if end branch head == tested commit and exact-commit verdict is INCONCLUSIVE -> `status = INCONCLUSIVE`, `satisfied = false`.

A stale gate is **not** a failed test. It means the test result is valid for an older exact commit but does not authorize the current branch head.

## 11. Phase 5 — Independent review

Reviewer starts only after:

- ownership audit finished;
- install outcome is known;
- typecheck finished;
- full tests finished;
- build finished;
- post-run integrity evidence exists;
- completion freshness evidence exists or is proven unavailable.

Reviewer checks:

1. control plane was frozen to one bootstrap commit;
2. protocol snapshot/object identities were captured before target execution;
3. target SHA was exact;
4. start-time target freshness obeyed active target policy;
5. original worktree was not destructively prepared;
6. every required command has evidence;
7. retry policy was obeyed;
8. ownership audit has no unclassified production constructor/path;
9. no required gate was silently skipped;
10. no tracked product/test mutation influenced outcome;
11. completion freshness and `mainlineGate` are calculated independently from the exact-commit verdict;
12. later remote repository updates were never allowed to mutate the frozen run definition;
13. final verdict follows Section 12 mechanically.

Reviewer MUST NOT rerun failed product gates or modify source.

## 12. Exact-commit verdict rules

Use exactly one top-level `verdict` for the exact tested commit.

### PASS

All are true:

- valid exact target was pinned at start;
- dependency preparation succeeded;
- ownership audit passed all six rules;
- `npm run typecheck` exit code 0;
- `npm test` exit code 0;
- `npm run build` exit code 0;
- no disallowed tracked modifications;
- required evidence is present;
- control-plane freeze was preserved;
- no material protocol deviation occurred.

PASS says only that the exact tested commit passed. Consult `mainlineGate` to determine whether that PASS still gates the current branch head.

### FAIL

Use when the exact target was valid/runnable but a deterministic repository/product gate failed, including:

- ownership violation;
- typecheck failure;
- test failure;
- build failure;
- deterministic dependency/integrity failure;
- tracked source/test mutation used during validation.

Do not auto-fix before reporting FAIL.

### BLOCKED

Use when the test cannot safely establish its frozen inputs or start target, including:

- wrong repository;
- missing control-plane file;
- inconsistent control-plane snapshot;
- missing target branch/commit;
- start branch head != configured commit for a blocking target (`ACTIVE_TEST_STALE`);
- unable to create safe isolated worktree.

### INCONCLUSIVE

Use when exact target is valid but external infrastructure prevents reliable completion after the predefined retry policy, or required evidence is irretrievably incomplete for reasons not shown to be a repository defect.

## 13. Deferred-test retention and later replay

`DEFERRED_TESTS.json` is the repository's non-blocking test ledger.

### 13.1 Registration

A deferred entry records at least:

- stable `testId`;
- profile;
- classification = `deferred`;
- status;
- whether it blocks mainline (must be false for this ledger);
- registration context (`registeredAgainst`);
- execution policy;
- release/milestone deadline if any.

A `planned` entry may have no execution target yet.

A `pending` entry must be bound to an exact executable commit before Codex runs it.

### 13.2 Retention requirement

While a deferred test is `planned`, `pending`, or `running`, do not intentionally discard the only information needed to reconstruct it.

If an exact execution target is bound, keep at least one reachable locator/reference for that target until the run is completed or the entry is explicitly rebound. If a branch is about to be deleted, first preserve another reachable locator or record a replacement exact target through an authorized repository-maintenance change.

The Codex test executor itself does not create or delete retention refs because remote mutation is prohibited during test execution.

### 13.3 Historical replay

Historical replay uses a retained exact original target. Its result remains scoped to that commit forever.

### 13.4 Forward validation

Forward validation creates a new exact execution target for the same retained test intent. It must preserve the registration context and previous run history. Never overwrite an older run or rename an old result as if it tested the new target.

### 13.5 Mainline behavior

Deferred tests do not pause ordinary mainline work unless their classification is explicitly promoted to blocking by a versioned control-plane change.

A deferred test may still be marked `requiredBefore` a later milestone such as `release-candidate`. That deadline is a future gate, not a current mainline block.

## 14. Protocol deviations

A protocol deviation is any execution differing from this Runbook or `CODEX_AGENT_PLAN.md` and not explicitly allowed.

Examples:

- substituting a different command;
- changing target SHA mid-run;
- rereading a newer remote protocol after freeze;
- adding an unplanned retry;
- serializing a declared parallel wave without resource/safety reason;
- running performance-sensitive A/B tasks concurrently on contended resources;
- editing source/tests;
- using a different suite;
- treating a stale blocking PASS as current gate satisfaction;
- silently dropping a deferred test definition or old run result.

Every deviation must be recorded. A material deviation prevents PASS.

## 15. Cleanup

After result/evidence finalization, Coordinator may remove only the temporary detached worktree created for this run using normal Git worktree removal.

Never remove or clean the user's original worktree.

Evidence must remain at the path reported in final result unless the execution environment itself is ephemeral.

## 16. Final output

Write `result.json` in the external evidence directory and emit the same logical object in the final response, conforming to `TEST_RESULT_SCHEMA.json`.

The final response must distinguish:

- exact-commit verdict;
- mainline gate status;
- whether repository movement occurred during the run;
- pending deferred tests known from the frozen deferred registry.

Do not provide remediation commits during validation. Fixes are a separate implementation task.