# Direct Codex vs Workbench Native A/B result

- testId: direct-codex-vs-workbench-native-ab-v1
- runId: native-ab-20260829T115200Z-7420b7c
- protocol: 1.0.0
- exact tested commit: 7420b7c6ce93201641c7e79e33e05392602ebf01
- verdict: FAIL
- release recommendation: DO_NOT_PROMOTE

## Repository gate

| Gate | Status | Attempts |
|---|---:|---:|
| npm ci | PASS | 1 |
| npm run typecheck | PASS | 1 |
| targeted parity contract | PASS | 1 |
| npm test | FAIL | 1 |
| npm run build | PASS | 1 |

The full test gate reported 572 tests, 571 passed, and 1 failed at tests/workspace-layout-contract.test.ts:10:1 with assertion workspace conversation shell must close. The failure was deterministic on the exact target and was not retried.

## Static parity audit

The read-only audit passed the protocol expected shape:

ordinaryNativeSharedHost=true, ordinaryNativeDynamicTools=false, ordinaryNativeWorkbenchDeveloperInstructions=false, conversationMapIndependentRuntime=false, projectMapDirectCompatClient=false, automationNativeCreatesRuntime=false, unclassifiedRuntimeOwnerCount=0.

## Model trial status

The deterministic repository-gate failure triggered the protocol stop rule. Model discovery, warmup, and all formal Direct/Workbench trials were not started. No binary, model, latency, token, envelope, or task-success measurement is claimed.

Full raw evidence and independent review remain outside the result sink at:

C:\Users\sadar\AppData\Local\Temp\codex-workbench-tests\native-ab-20260829T115200Z-7420b7c

The execution worktree remained read-only and the original user worktree was not modified.
