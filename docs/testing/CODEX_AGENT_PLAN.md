# Codex test agent plan

Protocol version: **1.0.0**

This file defines the execution topology for the active repository test. Codex must follow this DAG instead of choosing its own subagent structure.

## 1. Roles

### Coordinator — `coord`

Owns orchestration only.

Responsibilities:

- read and freeze the protocol inputs;
- record bootstrap repository identity;
- fetch and verify the declared target branch/SHA;
- create the isolated detached target worktree;
- create the external evidence directory;
- run dependency installation;
- enforce barriers;
- launch subagents at the declared waves;
- collect status from every subagent;
- run post-run Git integrity checks;
- hand complete evidence to the independent reviewer;
- emit the final schema-compliant result.

Forbidden:

- changing target or protocol;
- editing production/tests;
- rerunning failed correctness gates to obtain a green result;
- substituting itself for a failed subagent without recording a protocol deviation.

### Agent A — `env-audit`

Scope: environment and target identity evidence.

Starts after: `B0_TARGET_PINNED`.

Inputs:

- exact target worktree path;
- exact target SHA;
- evidence path.

Tasks:

- record Git/Node/npm/OS/architecture versions;
- independently verify target `HEAD` equals the configured SHA;
- record target worktree initial Git status;
- inspect repository-declared tool/version constraints if present;
- report environment risks, but do not change versions/configuration.

Writes only to: external `environment/` evidence directory.

### Agent B — `ownership-audit`

Scope: production static ownership audit from Runbook Section 7.

Starts after: `B0_TARGET_PINNED`.

This agent intentionally starts **in parallel with `npm ci`** because it only reads tracked source and does not need dependencies.

Tasks:

- search all production files under `src/` for the required constructor/bootstrap/fallback patterns;
- create a complete occurrence inventory;
- classify each production occurrence under the allowed ownership rules;
- inspect the four required focused files when present;
- explicitly answer the six ownership result questions;
- flag every unclassified occurrence;
- do not edit any source.

Writes only to: external `ownership-audit/` evidence directory.

### Agent C — `typecheck`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm run typecheck
```

Capture stdout/stderr/exit status/timestamps. No retry.

Writes only to: external `typecheck/` evidence directory, except for unavoidable temporary files created by the toolchain.

### Agent D — `full-tests`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm test
```

Capture stdout/stderr/exit status/timestamps. No retry.

Do not reduce to a targeted subset. Do not edit failures.

Writes only to: external `tests/` evidence directory, except for unavoidable temporary files created by the test runner.

### Agent E — `build`

Starts after: `B1_DEPENDENCIES_READY`.

Run only:

```text
npm run build
```

Capture stdout/stderr/exit status/timestamps. No retry.

Generated/ignored build output is allowed inside the isolated worktree. Source/test/protocol edits are not.

Writes evidence to: external `build/` evidence directory.

### Agent F — `independent-review`

Starts only after: `B2_CORRECTNESS_GATES_DONE`, ownership audit completion, and Coordinator post-run integrity capture.

This agent is deliberately last and must not participate in implementation or earlier gate execution.

Tasks:

- inspect all evidence, not just agent summaries;
- verify required steps are complete;
- check target identity and stale-pointer rule;
- check retry records;
- check source ownership classifications;
- check exit codes;
- check tracked-worktree integrity;
- enumerate protocol deviations;
- calculate the verdict strictly from Runbook Section 11;
- produce a review record for the Coordinator.

Forbidden:

- modifying source/tests;
- rerunning a failed product gate;
- overriding a FAIL/BLOCKED/INCONCLUSIVE because historical CI was green.

## 2. Dependency DAG

```text
Read bootstrap protocol
        |
        v
Coordinator: resolve exact target + create detached worktree
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
                    Agent F independent review
                               |
                               v
                       Coordinator final result
```

## 3. Required parallel waves

### Wave 1

As soon as `B0_TARGET_PINNED` is satisfied, start concurrently:

- Agent A (`env-audit`)
- Agent B (`ownership-audit`)
- Coordinator dependency installation (`npm ci`)

Reason: A and B are read-only and do not depend on installed packages. Running them during dependency installation hides avoidable waiting time.

### Wave 2

As soon as `B1_DEPENDENCIES_READY` is satisfied, start concurrently:

- Agent C (`npm run typecheck`)
- Agent D (`npm test`)
- Agent E (`npm run build`)

These are correctness gates, not benchmark measurements. They may contend for CPU; their durations are evidence only and MUST NOT be compared as performance metrics.

### Wave 3

Agent F starts only when every prerequisite artifact is present. Review is serialized because it depends on the complete evidence set.

## 4. Shared workspace rules

All execution agents may read the same isolated detached target worktree.

Allowed concurrent mutation is intentionally narrow:

- `npm ci` completes before Wave 2 starts;
- build may write generated `dist`/build output after dependencies are ready;
- typecheck and tests must not edit tracked source;
- evidence is never written into the worktree.

If a command would require editing tracked files, stop that agent and report the requirement; do not grant it write authority.

Agents must never operate on the user's original worktree except Coordinator's initial read-only identity/status capture.

## 5. Resource-contention rule

For the current `repository-exact-head-validation` profile, parallel C/D/E execution is required unless the host cannot safely launch them concurrently. If concurrency is impossible due to a hard platform/resource limit, serialize only the affected gates and record the reason as a protocol deviation. A material unrecorded serialization prevents PASS.

Do not derive latency/throughput conclusions from this profile.

For the future `direct-codex-vs-workbench-native-ab` profile, timed A/B trials must **not** run concurrently on the same constrained CPU/memory/App Server resource because that would contaminate measurements. That future profile must use isolated resources or a counterbalanced serialized schedule while allowing independent source audits/log processing to remain parallel.

## 6. Failure propagation

A subagent failure does not authorize another agent to repair product code.

- identity/precondition failure -> Coordinator prepares `BLOCKED` evidence;
- external install infrastructure failure after allowed retry -> `INCONCLUSIVE` candidate;
- deterministic install/typecheck/test/build/ownership failure -> `FAIL` candidate;
- missing subagent evidence -> reviewer marks incomplete and prevents PASS.

Even after one deterministic correctness failure, other already-running parallel gates should normally be allowed to finish so the result contains a complete failure surface, unless continuing would be unsafe or destructive.

## 7. Subagent report contract

Each agent returns a small machine-readable summary to Coordinator:

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

Agent summaries are indexes to evidence, not substitutes for evidence.

## 8. No idle-agent rule

Do not create subagents before their dependencies are ready merely to have them wait. Launch each agent at the earliest dependency barrier that gives it useful work.

Do not create multiple agents for the same gate. One owner per gate prevents duplicate executions and conflicting evidence.
