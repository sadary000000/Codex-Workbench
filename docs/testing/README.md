# Repository-owned Codex test control plane

This directory lets a Codex executor start from the repository itself instead of depending on a long user prompt.

## Entry chain

```text
repository URL / checked-out repository
  -> /AGENTS.md
  -> /docs/testing/ACTIVE_TEST.json
  -> /docs/testing/CODEX_TEST_RUNBOOK.md
  -> /docs/testing/CODEX_AGENT_PLAN.md
  -> /docs/testing/TEST_RESULT_SCHEMA.json
  -> isolated exact-SHA execution
  -> structured result + evidence
```

The root `AGENTS.md` is intentionally small. It only routes repository-test requests into this versioned control plane.

## Files

- `ACTIVE_TEST.json` — single authoritative pointer to the currently approved test target and protocol version.
- `CODEX_TEST_RUNBOOK.md` — exact execution procedure, safety rules, gates, evidence requirements, retry rules, and verdict semantics.
- `CODEX_AGENT_PLAN.md` — coordinator/subagent DAG, parallel waves, barriers, workspace ownership, and resource isolation.
- `TEST_RESULT_SCHEMA.json` — machine-readable final result contract.

## Design rules

1. **Exact commit, not floating branch.** The active branch is only used to fetch and cross-check the target. Testing is performed against the exact SHA.
2. **Original workspace is never prepared destructively.** The executor creates a detached isolated worktree for the target SHA.
3. **Protocol changes are versioned repository changes.** Codex executes the protocol; it does not redesign it.
4. **Parallelism is explicit.** Work that can safely overlap is declared in the agent plan. Shared-state or performance-sensitive work is serialized.
5. **Product code is read-only during validation.** A failed gate is evidence, not an invitation to auto-fix the implementation.
6. **No blind retries.** Only retries explicitly allowed by the Runbook are permitted and every retry is recorded.
7. **Evidence precedes verdict.** PASS/FAIL/BLOCKED/INCONCLUSIVE must be justified by captured command results and audit records.

## Updating the active test

When a new validation target is ready, update `ACTIVE_TEST.json` in a bounded repository change. The pointer must contain both the branch locator and the exact target commit. If the branch moves, the pointer is intentionally considered stale until updated.

The currently planned follow-on profile after the repository exact-head gate is Direct Codex vs Workbench Native A/B validation. That profile must add its own benchmark-specific isolation and timing rules before becoming active.