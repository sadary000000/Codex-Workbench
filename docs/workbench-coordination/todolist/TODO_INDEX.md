# Workbench Todo Index

Updated: 2026-09-03

This file is a discovery projection. Re-read the individual Todo before claiming or reviewing it.

## READY

| ID | Priority | Goal | Execution requirement |
| --- | --- | --- | --- |
| `RC-001` | P0 | Identify the exact reproducible Unit/integration regression on Recovery product snapshot `1e9d2ea...` without changing product code. | Before claim, prove either non-empty raw GitHub Actions stdout/stderr access for the failing job or exact-SHA checkout + Node/dependency/`npm test` execution capability. |

## IN_PROGRESS

None.

## WAITING_REVIEW

None.

## BLOCKED

None.

## ACCEPTED / FOLLOW_UP_REQUIRED

None.

## Current queue rationale

The active v0.1 Recovery Closure is still blocked at the product level by a reproducible Unit/integration failure on exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, but the coordination Todo is now safely requeued after Project Lead triage classified the first Worker attempt as `ENVIRONMENT_MISMATCH`.

Attempt 1 remains durable in `TODO-RC-001.md` and `REPORT-RC-001.md`. The first Worker and Project Lead both confirmed that the available GitHub metadata/log surface did not expose the raw assertion; the Project Lead's latest run-log probe returned an empty payload, while exact local reproduction was unavailable in that Worker environment.

`RC-001` is therefore `READY + UNCLAIMED` only for a Worker that passes the explicit pre-claim capability checks encoded in the Todo. A Worker that cannot prove either raw log access or exact-SHA local reproduction capability must skip it without claiming.

No product-fix Todo is queued yet. The exact failing assertion, expected value, and actual value must be obtained first; creating a fix task before that evidence exists would be speculative and would violate the current Recovery checkpoint.
