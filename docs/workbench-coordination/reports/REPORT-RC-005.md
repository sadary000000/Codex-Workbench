# REPORT-RC-005

## Result

Repaired the Native executor target UI regression test contract.

## Product SHA / branch context

Branch: `fix/v01-recovery-closure`

Assignment update commit: `b37c8846a3e07773702520dcfd15be2b21dd2020`

Test update commit: `7378f36ec51850848783d4e36a3e1c29682b211d`

## Changed files

- `tests/automation-native-executor-target-ui.test.ts`

## Confirmed findings

The previous test asserted the obsolete literal confirmation form `Execute Step ${step.stepKey}...`. The renderer now derives the operation label from retry state (`Retry` or `Execute`) and keeps the exact Native Thread target in the confirmation.

The repaired test now checks:

- Runtime Truth target acquisition.
- Explicit target selection.
- Execute/Retry confirmation semantics.
- Failed Attempt history preservation wording for Retry.
- Exact target identity preflight and `NATIVE_EXECUTOR_TARGET_CHANGED` protection.
- No renderer workflow-state-machine regression.

## Validation

Required validation:

`node --experimental-strip-types --test tests/automation-native-executor-target-ui.test.ts`

Status: NOT RUN

Reason: this Worker environment has no checked-out repository workspace; direct GitHub access was used for source inspection and edits. Local execution could not be performed.

## Remaining risk

The test assertions were updated against inspected source content. A local Node test run is still required for independent confirmation.

## Next action

Project Lead should run the focused Node test and independently review the diff before acceptance.
