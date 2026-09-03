# Workbench Todo Index

Updated: 2026-09-03

This file is a discovery projection. Re-read the individual Todo before claiming or reviewing it.

## READY

None.

## IN_PROGRESS

None.

## WAITING_REVIEW

None.

## BLOCKED

| ID | Priority | Goal | Blocker |
| --- | --- | --- | --- |
| `RC-001` | P0 | Identify the exact reproducible Unit/integration regression on Recovery product snapshot `1e9d2ea...` without changing product code. | Raw failing assertion/expected/actual unavailable from current GitHub tool surface; exact-SHA local reproduction environment unavailable. |

## ACCEPTED / FOLLOW_UP_REQUIRED

None.

## Current queue rationale

The active v0.1 Recovery Closure remains blocked by a reproducible Unit/integration failure on exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`. Project Lead independently reviewed `REPORT-RC-001.md` and confirmed the blocker, but did not accept the task because its core acceptance evidence is missing. No product-fix Todo is queued until raw failing-test evidence is obtained; creating one now would require guessing.
