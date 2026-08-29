# Codex test agent plan

Protocol version: **1.1.0**

This file defines the execution topology for the active repository test. Codex must follow this DAG instead of choosing its own subagent structure.

## 1. Roles

### Coordinator — `coord`

Owns orchestration only.

Responsibilities:

- record and freeze the bootstrap control-plane commit;
- snapshot all protocol files and their Git object ids before target execution;
- record bootstrap repository identity;
- fetch and verify the declared target branch/SHA;
- create the isolated detached target worktree;
- create the external evidence directory;
- run dependency installation;
- enforce barriers;
- launch subagents at the declared waves;
- collect status from every subagent;
- run post-run Git integrity checks;
- perform the completion branch-freshness check without changing the tested worktree;
- calculate preliminary `mainlineGate` applicability from target movement and gate outcomes;
- hand complete evidence to the independent reviewer;
- emit the final schema-compliant result.

Forbidden:

- changing target or protocol after freeze;
- rereading a newer remote protocol during the run;
- editing production/tests;
- rerunning failed correctness gates to obtain green;
- substituting itself for a failed subagent without recording a protocol deviation;
- treating a stale exact-target PASS as a current mainline gate PASS.

### Agent A — `env-audit`

Scope: environment and target identity evidence.

Starts after: `B0_TARGET_PINNED`.

Inputs:

- exact target worktree path;
- exact target SHA;
- frozen control-plane commit;
- evidence path.

Tasks:

- record Git/Node/npm/OS/architecture versions;
- independently verify target `HEAD` equals configured SHA;
- record target worktree initial Git status;
- inspect repository-declared tool/version constraints if present;
- report environment risks without changing versions/configuration.

Writes only to external `environment/` evidence.

### Agent B — `ownership-audit`

Scope: production static ownership audit from Runbook Section 8.

Starts after: `B0_TARGET_PINNED`.

This agent intentionally runs **in parallel with `npm ci`** because it only reads tracked source and needs no installed dependencies.

Tasks:

- search all production files under `src/` for required constructor/bootstrap/fallback patterns;
- create complete occurrence inventory;
- classify each production occurrence under allowed ownership rules;
- inspect required focused files when present;
- answer the six ownership result questions;
- flag every unclassified occurrence;
- never edit source.

Writes only to external `ownership-audit/` evidence.

### Agent C — `typecheck`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm run typecheck
```

Capture stdout/stderr/exit/timestamps. No retry.

### Agent D — `full-tests`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm test
```

Capture stdout/stderr/exit/timestamps. No retry. Do not reduce to a targeted subset.

### Agent E — `build`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm run build
```

Capture stdout/stderr/exit/timestamps. No retry.

Generated/ignored build output is allowed. Tracked source/test/protocol edits are not.

### Agent F — `independent-review`

Starts only after:

- `B2_CORRECTNESS_GATES_DONE`;
- ownership audit complete;
- post-run integrity capture complete;
- completion branch-freshness evidence complete or proven unavailable.

This agent is deliberately last and did not participate in implementation or earlier gate execution.

Tasks:

- inspect all raw evidence, not just summaries;
- verify the control-plane snapshot came from one bootstrap commit;
- verify no newer remote protocol was substituted mid-run;
- verify exact target identity and start freshness;
- inspect retry records;
- inspect ownership classifications;
- inspect exit codes;
- inspect tracked-worktree integrity;
- independently recompute completion freshness and `mainlineGate`;
- distinguish exact-commit verdict from gate applicability;
- enumerate protocol deviations;
- calculate verdict strictly from Runbook Section 12;
- report pending deferred tests from the frozen deferred registry without auto-running them.

Forbidden:

- modifying source/tests;
- rerunning a failed product gate;
- overriding FAIL/BLOCKED/INCONCLUSIVE because historical CI was green;
- declaring a stale blocking result current.

## 2. Dependency DAG

```text
Repository supplied by user
        |
        v
Coordinator: freeze controlPlaneCommit + snapshot protocol
        |
        v
B-1_CONTROL_PLANE_FROZEN
        |
        v
Coordinator: resolve exact target + detached worktree
        |
        v
B0_TARGET_PINNED
        |
        +----------------------+----------------------+
        |                      |                      |
        v                      v                      v
Agent A env audit       Agent B ownership audit    Coordinator npm ci
        |                      |                      |
        |                      |                      v
        |                      |               B1_DEPENDENCIES_READY
        |                      |                      |
        |                      |           +----------+----------+
        |                      |           |          |          |
        |                      |           v          v          v
        |                      |        Agent C    Agent D    Agent E
        |                      |        typecheck  tests      build
        |                      |           |          |          |
        |                      |           +----------+----------+
        |                      |                      |
        |                      |             B2_CORRECTNESS_GATES_DONE
        |                      |                      |
        +----------------------+----------------------+
                               |
                               v
                    Coordinator integrity capture
                               |
                               v
                    Completion branch freshness
                               |
                               v
                    Agent F independent review
                               |
                               v
                 exact verdict + mainlineGate result
```

## 3. Barriers

### `B-1_CONTROL_PLANE_FROZEN`

Satisfied only when:

- bootstrap `HEAD` is recorded as `controlPlaneCommit`;
- all required protocol files are copied to external evidence from that commit;
- Git object identity is recorded for each protocol file;
- protocol versions and referenced paths are internally consistent.

No target command may start before this barrier.

### `B0_TARGET_PINNED`

Satisfied only when:

- repository identity is valid;
- start branch freshness policy passes;
- detached worktree exists at exact configured target SHA;
- initial target worktree status is clean.

### `B1_DEPENDENCIES_READY`

Satisfied only when dependency installation succeeds under Runbook retry rules.

### `B2_CORRECTNESS_GATES_DONE`

Satisfied when C/D/E have all terminated and evidence exists for every gate, regardless of individual PASS/FAIL.

## 4. Required parallel waves

### Wave 0 — control plane and target

Coordinator work is serialized through `B-1` and `B0`. Do not start subagents against a target before the immutable inputs are frozen.

### Wave 1

Immediately after `B0_TARGET_PINNED`, start concurrently:

- Agent A (`env-audit`)
- Agent B (`ownership-audit`)
- Coordinator dependency installation (`npm ci`)

Reason: A and B are read-only and do not depend on installed packages. Their work hides dependency-install waiting time.

### Wave 2

Immediately after `B1_DEPENDENCIES_READY`, start concurrently:

- Agent C (`npm run typecheck`)
- Agent D (`npm test`)
- Agent E (`npm run build`)

These are correctness gates, not benchmark trials. Their durations are evidence only and must not be interpreted as product performance measurements.

### Wave 3

After correctness, ownership, integrity, and completion freshness are available, start Agent F. Review is serialized because it needs the complete evidence set.

## 5. Shared workspace rules

All execution agents may read the same detached exact-target worktree.

Allowed concurrent mutation is narrow:

- `npm ci` completes before Wave 2;
- build may write ordinary generated output;
- typecheck/tests must not edit tracked source;
- all evidence is written outside the worktree.

If a command requires tracked-file edits, stop that agent and report the requirement. Do not grant write authority.

Agents never operate on the user's original worktree except Coordinator's initial read-only identity/status capture.

## 6. Concurrent GitHub updates

Remote updates after `B-1_CONTROL_PLANE_FROZEN` do not change the run definition.

Remote updates after `B0_TARGET_PINNED` do not change the tested source.

Coordinator MUST NOT restart or retarget merely because another actor pushes new commits.

For a blocking test, Coordinator performs one explicit completion freshness observation after all exact-target work is finished. If the target branch has moved, the exact-target result remains valid but the mainline gate becomes `STALE`.

Agents do not poll remote branch state continuously. One start observation and one completion observation are sufficient for this protocol.

## 7. Resource-contention rule

For `repository-exact-head-validation`, parallel C/D/E is required unless a hard platform/resource limit prevents safe concurrency. If serialization is necessary, record the affected gates and reason as a protocol deviation. An unrecorded material serialization prevents PASS.

Do not derive latency/throughput conclusions from this profile.

For `direct-codex-vs-workbench-native-ab`, timed A/B trials must **not** run concurrently on the same constrained CPU/memory/App Server resource. That profile must use isolated resources or a counterbalanced serialized schedule. Independent source audit, environment collection, evidence normalization, and log analysis should still be parallelized where they cannot contaminate measurements.

## 8. Deferred-test execution rule

`DEFERRED_TESTS.json` is visible to Coordinator and Reviewer, but deferred entries are not automatically added to the active critical path.

For the ordinary minimal request "test this repository":

- execute only `ACTIVE_TEST.json`;
- report the number/IDs/statuses of deferred entries in the summary;
- do not run a `planned` deferred entry;
- do not bind a missing execution target yourself.

If the user explicitly asks to run deferred/backlog tests:

- only entries already marked executable with an exact target may run without a repository-maintenance change;
- independent deferred runs may run in parallel with each other only if their profile resource rules allow it;
- every deferred run gets its own evidence root and exact target result;
- historical runs are append-only evidence and never replace prior results.

## 9. Failure propagation

A subagent failure never authorizes product repair.

- control-plane/identity/precondition failure -> `BLOCKED` candidate;
- external install infrastructure failure after allowed retry -> `INCONCLUSIVE` candidate;
- deterministic install/typecheck/test/build/ownership failure -> `FAIL` candidate;
- missing evidence -> reviewer marks incomplete and prevents PASS.

Even after one deterministic correctness failure, already-running independent gates normally finish to expose the complete failure surface unless continuing is unsafe/destructive.

## 10. Subagent report contract

Each agent returns a small machine-readable summary:

```json
{
  "agentId": "...",
  "status": "PASS|FAIL|BLOCKED|INCONCLUSIVE",
  "startedAt": "UTC ISO-8601",
  "finishedAt": "UTC ISO-8601",
  "evidencePaths": ["..."],
  "commands": [
    {
      "name": "...",
      "exitCode": 0,
      "stdout": "...",
      "stderr": "..."
    }
  ],
  "findings": ["..."],
  "protocolDeviations": []
}
```

Summaries index raw evidence; they do not replace it.

## 11. No idle-agent rule

Do not create subagents before their dependency barrier simply to have them wait. Launch each role at the earliest barrier that gives it useful work.

Do not create multiple agents for the same gate. One owner per gate prevents duplicate execution and conflicting evidence.