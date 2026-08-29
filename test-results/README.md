# Codex test results

This branch is the repository-owned, append-only sink for structured Codex test results.

## Identity model

A **test project** is identified by one stable `testId`. A test project may have many runs, but every run belongs to exactly one test project.

```text
test-results/<testId>/
  TEST.json
  runs/
    <runId>/
      manifest.json
      result.json
      summary.md
      failures.md          # optional
      metrics.json         # optional
      evidence-index.json  # optional
```

Required identity invariant:

```text
path testId
== TEST.json.testId
== manifest.json.testId
== result.json.testId
== one authoritative test definition from the frozen control plane
```

Required run invariant:

```text
path runId
== manifest.json.runId
== result.json.run.runId
```

A run directory is immutable after first successful publication. Never overwrite, amend, delete, or reinterpret an older run. A later execution of the same test project creates a new `runId` directory.

## What belongs here

Commit only small, structured result material needed for durable review:

- `manifest.json`
- `result.json`
- `summary.md`
- optional bounded `failures.md`
- optional `metrics.json`
- optional `evidence-index.json`

Do not commit `node_modules`, build output, caches, binary archives, full raw logs, or source-code changes. Large raw evidence should remain in an external artifact store and be referenced by immutable locator/digest from `evidence-index.json`.

## Publication safety

Product/test execution happens against an exact detached target and remains read-only. Result publication is a separate post-review phase. Publication may write only this branch and only under `test-results/`.

- fast-forward pushes only;
- never force-push;
- never delete an older run;
- never modify product source on this branch as part of result publication;
- if another publisher advances this branch, fetch the new head and re-apply the same new run package on top; never rewrite the other publisher's result;
- if the intended run path already exists, stop and report a collision rather than overwrite it.

The authoritative publication contract lives in `docs/testing/TEST_RESULTS_POLICY.json` on the frozen repository test control-plane commit.
