# Repository-owned Codex test control plane

This directory lets a Codex executor start from the repository itself instead of depending on a long user prompt.

## Entry chain

```text
repository URL / checked-out repository
  -> /AGENTS.md
  -> freeze bootstrap control-plane commit
  -> /docs/testing/ACTIVE_TEST.json
  -> /docs/testing/DEFERRED_TESTS.json
  -> /docs/testing/CODEX_TEST_RUNBOOK.md
  -> /docs/testing/CODEX_AGENT_PLAN.md
  -> /docs/testing/TEST_RESULT_SCHEMA.json
  -> isolated exact-SHA execution
  -> exact-commit verdict + mainline gate applicability
  -> structured result + evidence
```

The root `AGENTS.md` stays intentionally small. It routes repository-test requests into this versioned control plane.

## Files

- `ACTIVE_TEST.json` — authoritative pointer to the currently active test target, blocking class, freshness policy, and protocol version.
- `DEFERRED_TESTS.json` — retained non-blocking test intents/backlog. These do not enter the active critical path unless explicitly activated or requested.
- `CODEX_TEST_RUNBOOK.md` — exact execution procedure, control-plane freeze, exact-target isolation, freshness checks, evidence, retry rules, verdict semantics, and deferred replay rules.
- `CODEX_AGENT_PLAN.md` — coordinator/subagent DAG, barriers, parallel waves, resource isolation, completion freshness, and deferred execution rules.
- `TEST_RESULT_SCHEMA.json` — machine-readable final result contract separating exact-target verdict from mainline gate applicability.

## Why GitHub can keep changing while Codex tests

A run freezes two independent things:

1. **Control-plane truth** — the bootstrap checkout commit plus the exact protocol file objects from that commit.
2. **Test target truth** — the exact product/test commit executed in a detached worktree.

Once both are pinned, later pushes do not mutate that run. Codex must not reread a newer Runbook or silently switch to a newer source commit.

For a **blocking** test, the target branch is checked again when the run finishes. If the branch moved, the exact tested commit can still PASS, but `mainlineGate` becomes `STALE` and the PASS cannot authorize the newer head.

For a **deferred** test, branch/mainline movement is expected. The result is historical evidence for the exact execution target and never blocks current work unless a future versioned control-plane change promotes that test to blocking.

## Blocking vs deferred

### Blocking

Use when the result must gate the current milestone/branch head.

Properties:

- listed in `ACTIVE_TEST.json`;
- exact target must match branch head before execution;
- exact target is rechecked against branch head at completion;
- current mainline gate is satisfied only by PASS on the still-current exact target.

### Deferred

Use when the test is useful but does not need to pause mainline progress.

Properties:

- retained in `DEFERRED_TESTS.json`;
- `blocksMainline = false`;
- planned entries can wait for a future exact execution target;
- pending entries must bind an exact commit before execution;
- historical replay and forward validation are separate runs;
- old results are append-only evidence and are never overwritten or promoted to newer commits.

A deferred test may still declare `requiredBefore` a future milestone such as `release-candidate`.

## Deferred-test retention rule

Do not lose the only way to reconstruct a pending exact target. Until a deferred exact target is completed or rebound, keep at least one reachable locator/reference for it. If a branch is going to be deleted, first preserve another authorized locator or explicitly rebind the deferred entry.

The test executor itself never creates/deletes remote refs because test execution is read-only with respect to repository state.

## Design rules

1. **Exact commit, not floating branch.** Branches are locators/freshness signals; execution is exact-SHA.
2. **Frozen protocol.** One run uses one bootstrap control-plane commit from start to finish.
3. **Original workspace is never prepared destructively.** Execution uses a detached isolated worktree.
4. **Repository development may continue.** Other branches can move without corrupting a pinned run.
5. **Gate applicability is separate from test verdict.** A stale blocking PASS remains valid historical evidence but does not gate a newer head.
6. **Parallelism is explicit.** Safe work overlaps; shared-state or performance-sensitive work is serialized/isolated.
7. **Product code is read-only during validation.** A failed gate is evidence, not permission to fix.
8. **No blind retries.** Only Runbook-authorized retries are allowed and recorded.
9. **Deferred tests are retained, not forgotten.** They may be replayed later without blocking current mainline.
10. **Evidence precedes verdict.** PASS/FAIL/BLOCKED/INCONCLUSIVE comes from recorded evidence.

## Updating the active test

When a new blocking validation target is ready, update `ACTIVE_TEST.json` in a bounded repository change with both branch locator and exact target commit.

Do not mutate a running test by pushing a new protocol and asking the executor to pick it up mid-run. A new protocol or active target applies only to a new run.

## Adding a deferred test

Add a stable entry to `DEFERRED_TESTS.json`.

- `planned` is allowed without an execution target when the test intent is known but the harness/target is not ready.
- before execution, bind an exact target and move it to an executable state such as `pending` through a normal reviewed repository change;
- preserve `registeredAgainst` when later binding a newer forward-validation target;
- keep previous run evidence/results instead of overwriting them.

The Direct Codex vs Workbench Native A/B test is retained here as a planned deferred profile until its benchmark harness and exact execution target are ready.