# Repository-owned Codex test control plane

This directory lets a Codex executor start from the repository itself instead of depending on a long user prompt.

## Entry chain

```text
repository URL / checked-out repository
  -> /AGENTS.md
  -> freeze bootstrap control-plane commit
  -> /docs/testing/ACTIVE_TEST.json
  -> /docs/testing/DEFERRED_TESTS.json
  -> selected Runbook / agent plan / result schema
  -> /docs/testing/TEST_RESULTS_POLICY.json
  -> /docs/testing/TEST_RESULT_MANIFEST_SCHEMA.json
  -> isolated exact-SHA execution
  -> independent review
  -> frozen result.json + manifest.json
  -> fast-forward append to codex/test-results
```

## Test-project identity

`testId` is the stable primary key for a test project.

- The active blocking test is one test project.
- Every entry in `DEFERRED_TESTS.json.tests` is one test project.
- Test IDs must be unique across the frozen active definition and frozen deferred registry.
- One test project may have many historical runs.
- Every run belongs to exactly one test project.

The durable result path is:

```text
test-results/<testId>/runs/<runId>/
```

For a published run, all of these must match:

```text
frozen test definition testId
== path <testId>
== manifest.json.testId
== result.json.testId

path <runId>
== manifest.json.runId
== result.json.run.runId
```

The publication manifest also binds the frozen definition source object ID and SHA-256 digest, so a result cannot be reassigned to another test project just by renaming a directory.

## Files

- `ACTIVE_TEST.json` — authoritative blocking test pointer and exact target.
- `DEFERRED_TESTS.json` — retained non-blocking test projects/backlog.
- `CODEX_TEST_RUNBOOK.md` — active correctness/architecture execution procedure.
- `CODEX_AGENT_PLAN.md` — active coordinator/subagent DAG and barriers.
- `TEST_RESULT_SCHEMA.json` — active test's machine-readable result contract.
- `TEST_RESULTS_POLICY.json` — universal post-run publication/identity policy.
- `TEST_RESULT_MANIFEST_SCHEMA.json` — universal manifest contract for every published run, including test-specific profiles such as A/B.

A deferred test may point to a different result schema at its exact execution-target commit. The universal publication manifest still wraps that result and supplies the common `testId` / `runId` / definition / target binding.

## Execution writes vs result publication

Validation itself remains read-only with respect to GitHub and product/test source. The Runbook's no-push/no-edit rules remain in force through independent review and verdict calculation.

After the final result is frozen, a separate publication phase is allowed. Its only remote-write authority is:

```text
branch: codex/test-results
root:   test-results/
```

Publication is fast-forward and append-only. It cannot authorize product changes, test changes, branch deletion, tags, merges, or force-pushes.

If another Codex run publishes concurrently, the publisher may fetch the newer result-branch head and re-apply the same new immutable run package on top, within the bounded retry policy. It must not rerun the tested product merely because the result branch moved.

## Why GitHub can keep changing while Codex tests

A run freezes two independent things:

1. **Control-plane truth** — bootstrap commit plus frozen protocol/test-definition objects.
2. **Test target truth** — the exact product/test commit executed in a detached worktree.

Later pushes cannot mutate either frozen input.

For blocking tests, branch freshness is checked separately from the exact-commit verdict. A stale PASS remains valid historical evidence for the tested SHA but cannot gate the newer branch head.

For deferred tests, branch movement is expected. Historical replay and forward validation are distinct runs with distinct exact target bindings.

## Result retention

Published runs are durable repository evidence.

- never overwrite an old run;
- never delete an old run to hide a failure;
- never reinterpret an old PASS as proof for a newer commit;
- never publish two different results under the same `runId`;
- large raw logs stay outside Git and are referenced by bounded `evidence-index.json` entries/digests.

The result branch owns structured test evidence only; it is not a product-development branch.
