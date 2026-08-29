# Codex repository test Runbook

Protocol version: **1.0.0**

This file is the execution authority for repository-owned validation. Codex is the executor, not the test designer. Do not change the test method during a run.

## 1. Purpose

The active profile `repository-exact-head-validation` verifies that the exact Git commit selected by `ACTIVE_TEST.json` is reachable, reproducible, buildable, test-clean, and consistent with the current Native-first ownership boundary.

This profile is a correctness/architecture gate. It is **not** a latency or throughput benchmark. Commands intentionally run in parallel where safe, so their wall-clock times must not be interpreted as product performance measurements.

## 2. Authority and immutable inputs

Before running any command, read all of these files from the repository bootstrap checkout:

1. `/AGENTS.md`
2. `/docs/testing/ACTIVE_TEST.json`
3. `/docs/testing/CODEX_TEST_RUNBOOK.md`
4. `/docs/testing/CODEX_AGENT_PLAN.md`
5. `/docs/testing/TEST_RESULT_SCHEMA.json`

The following fields from `ACTIVE_TEST.json` are immutable inputs for the run:

- `repository`
- `testId`
- `profile`
- `target.branch`
- `target.commit`
- `protocol.version`

Do not replace a missing or inaccessible value with a guessed value.

## 3. Hard prohibitions

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
- treat the historical green workflow recorded in `knownEvidence` as current PASS evidence.

If a required step cannot be executed under these rules, return `BLOCKED` or `INCONCLUSIVE` according to Section 11.

## 4. Evidence location

Create a run identifier in the form:

```text
<testId>-<UTC timestamp>-<short target SHA>
```

Create an evidence directory in the operating system's temporary area, outside every Git worktree. Example logical layout:

```text
<OS temp>/codex-workbench-tests/<run-id>/
  bootstrap/
  environment/
  install/
  ownership-audit/
  typecheck/
  tests/
  build/
  review/
  result.json
```

Do not make evidence storage part of the Git source tree.

Every command record must contain:

- command or operation description;
- working directory;
- start timestamp UTC;
- end timestamp UTC;
- exit code when applicable;
- stdout path;
- stderr path;
- executor/agent id.

## 5. Phase 0 — Bootstrap identity and target resolution

Coordinator only.

### 5.1 Record bootstrap repository identity

From the repository supplied by the user, record without modifying it:

```text
git rev-parse --show-toplevel
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1
```

A dirty original worktree is allowed. Record it; do not alter it.

### 5.2 Validate repository identity

The origin must resolve to the repository named by `ACTIVE_TEST.json` or an equivalent authenticated GitHub URL for that exact repository.

If it refers to another repository, verdict = `BLOCKED`.

### 5.3 Fetch the declared target branch

Fetch only what is required to resolve the declared target. Do not update the current working branch.

Required logical operation:

```text
git fetch --no-tags origin <target.branch>
```

Then resolve the fetched remote branch head and compare it to `target.commit`.

The fetched branch head MUST equal the exact commit in `ACTIVE_TEST.json`.

- equal -> continue;
- branch does not exist / commit inaccessible -> `BLOCKED`;
- branch exists but head != configured commit -> `BLOCKED` with reason `ACTIVE_TEST_STALE`.

Do not silently test either the new branch head or the old configured commit when this mismatch occurs.

### 5.4 Create isolated target worktree

Create a new detached Git worktree in a temporary directory at exactly `target.commit`:

```text
git worktree add --detach <temporary-target-worktree> <target.commit>
```

Do not switch, reset, clean, or otherwise prepare the user's original worktree.

Inside the detached target worktree verify:

```text
git rev-parse HEAD
git status --porcelain=v1
```

Required:

- HEAD exactly equals `target.commit`;
- target worktree initially has no tracked or untracked changes.

If not, `BLOCKED`.

This completes barrier **B0_TARGET_PINNED**.

## 6. Phase 1 — Environment and dependency preparation

After `B0_TARGET_PINNED`, execute the Wave 1 plan defined in `CODEX_AGENT_PLAN.md`.

### 6.1 Environment evidence

Capture at minimum:

```text
git --version
node --version
npm --version
```

Also record OS/platform and CPU architecture using the platform's standard non-destructive command.

Do not reject an environment merely because its version differs from historical evidence unless the repository itself declares an incompatible engine/tool requirement or a required command fails because of that incompatibility.

### 6.2 Dependency installation

Coordinator owns dependency installation in the isolated target worktree:

```text
npm ci
```

Allowed retry policy:

- at most **one** retry;
- only if the first failure is clearly an external package-registry/network transport failure;
- never retry dependency-resolution errors, lifecycle-script failures, integrity failures, or source/test errors;
- record the first attempt and the retry as separate evidence records;
- a retry is not a protocol deviation because it is predefined here.

If installation still cannot complete due to external infrastructure, verdict = `INCONCLUSIVE`.

If installation fails deterministically because of repository/dependency state, verdict = `FAIL`.

Successful installation completes barrier **B1_DEPENDENCIES_READY**.

## 7. Phase 2 — Native ownership static audit

This audit may begin after `B0_TARGET_PINNED` and may run in parallel with dependency installation.

The ownership-audit agent MUST inspect production source under `src/`, not test fixtures, and create an occurrence inventory for at least:

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

The inventory must include file path, line, containing class/function, and classification.

Classify each occurrence against these rules:

1. Codex Native runtime/host adapters may own App Server process/client transport where they are the actual runtime owner.
2. Workbench Map coordinators must not create a second direct App Server client/process merely to perform compatibility fallback or reads.
3. Conversation Map must not own an independent fallback Native runtime for maintenance.
4. Project Map may own its single dedicated maintenance `NativeThreadRuntime` where dynamic-tools registration requires a fresh Native thread; that runtime must not coexist with an additional direct App Server compatibility fallback.
5. Project Map context/read gathering must use the shared/registered Native read boundary rather than create per-read App Server process ownership.
6. Workbench must not introduce a second transcript, sandbox, tool executor, subagent runtime, or context manager.

Required focused files include, when present:

- `src/codex/native-thread-runtime.ts`
- `src/codex/app-server-host.ts`
- `src/main/project-map-manager.ts`
- `src/main/map-coordinator.ts`

The agent must also search the rest of `src/` so the audit is not limited to these known files.

Any production occurrence that cannot be classified under an allowed owner is an audit failure. Do not edit it.

The audit output must explicitly answer:

```text
second_app_server_owner_detected: true|false
conversation_map_fallback_runtime_detected: true|false
project_map_direct_compat_fallback_detected: true|false
per_read_app_server_owner_detected: true|false
duplicate_transcript_or_tool_runtime_detected: true|false
unclassified_occurrence_count: <integer>
```

## 8. Phase 3 — Parallel correctness gates

After `B1_DEPENDENCIES_READY`, launch the three independent gate agents defined in the Agent Plan at the same time.

### Gate C — Typecheck

Run exactly:

```text
npm run typecheck
```

No retry for a non-zero exit.

### Gate D — Full repository tests

Run exactly:

```text
npm test
```

No retry for a non-zero exit.

Do not replace the full test suite with only targeted tests.

### Gate E — Build

Run exactly:

```text
npm run build
```

No retry for a non-zero exit.

The build is allowed to create ordinary ignored build output inside the isolated worktree. No source or test file may be edited.

When C, D, and E have all terminated, complete barrier **B2_CORRECTNESS_GATES_DONE**.

## 9. Phase 4 — Post-run integrity check

Coordinator records:

```text
git status --porcelain=v1
git diff --name-status
git diff --cached --name-status
```

Interpretation:

- ignored/generated output created by normal install/build is allowed;
- any modification to a tracked source, test, protocol, package manifest, lockfile, or configuration file caused during the run is a protocol failure unless the command itself is documented by the repository to generate that tracked file;
- never clean the evidence by deleting tracked changes before recording them.

## 10. Phase 5 — Independent review

Reviewer agent starts only after:

- ownership audit finished;
- install outcome is known;
- typecheck finished;
- full tests finished;
- build finished;
- post-run integrity evidence exists.

The reviewer MUST NOT rerun failed product gates and MUST NOT modify source.

Reviewer checks:

1. target SHA was exact;
2. active branch head matched configured SHA;
3. original user worktree was not destructively prepared;
4. every required command has evidence;
5. retry policy was obeyed;
6. ownership audit has no unclassified production constructor/path;
7. no required gate was silently skipped;
8. no tracked product/test change was used to influence outcome;
9. final verdict follows Section 11 mechanically.

## 11. Verdict rules

Use exactly one top-level verdict.

### PASS

All of the following are true:

- target branch/SHA identity verified;
- dependency preparation succeeded;
- ownership audit passed all six rules;
- `npm run typecheck` exit code 0;
- `npm test` exit code 0;
- `npm run build` exit code 0;
- no disallowed tracked modifications;
- all required evidence is present;
- no material protocol deviation occurred.

### FAIL

Use `FAIL` when the target was valid and runnable but a deterministic repository/product gate failed, including:

- source ownership violation;
- typecheck failure;
- test failure;
- build failure;
- deterministic dependency/repository integrity failure;
- tracked source/test mutation used during validation.

Do not auto-fix before reporting FAIL.

### BLOCKED

Use `BLOCKED` when the test cannot safely start because required identity/access/preconditions cannot be established, including:

- wrong repository;
- missing target branch/commit;
- branch head does not equal configured exact commit (`ACTIVE_TEST_STALE`);
- unable to create a safe isolated worktree;
- missing required protocol file.

### INCONCLUSIVE

Use `INCONCLUSIVE` when the target is valid but external infrastructure prevents reliable completion after the predefined retry policy, or required evidence is irretrievably incomplete for reasons not shown to be a repository defect.

## 12. Protocol deviations

A protocol deviation is any execution that differs from this document or `CODEX_AGENT_PLAN.md` and is not explicitly allowed there.

Examples:

- substituting a different command;
- changing the target SHA;
- adding an unplanned retry;
- serializing a declared parallel wave without a resource/safety reason;
- running performance-sensitive tasks concurrently when the profile prohibits it;
- editing source/tests;
- using a different test suite.

Every deviation must be recorded. A material deviation prevents PASS.

## 13. Cleanup

After result/evidence finalization, the Coordinator may remove only the temporary detached worktree that it created for this run using the normal Git worktree removal mechanism.

Never remove or clean the user's original worktree.

Evidence must remain available at the path reported in the final result unless the execution environment itself is ephemeral.

## 14. Final output

Write `result.json` in the external evidence directory and emit the same logical object in the final response, conforming to `TEST_RESULT_SCHEMA.json`.

The final response may include a short human summary, but it must not replace the structured result.

Do not provide remediation commits during the validation run. If the user later asks for fixes, that is a separate implementation task.
