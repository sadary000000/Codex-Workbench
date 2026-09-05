# TODO-RC-004

Status: `TODO`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Repair the Recovery Closure test fixture so all five recovery tests reach their intended business assertions without weakening Store/schema/Evidence validation.

## Evidence

The 2026-09-05 Pro investigation reproduced the full suite twice as `718 / 712 pass / 6 fail`; five failures are `tests/v01-step-recovery-closure.test.ts`. Live exact-SHA source inspection confirms the fixture creates an ACTIVE PlanVersion with `currentStageId: STAGE_ID` before the referenced StageSpec exists. The same test later creates STEP_VERIFICATION Evidence with an entirely empty correlation object. The external diagnostic copy reported that removing only the first fixture blocker exposed the invalid Evidence correlation as the remaining failure.

## Dependencies

None.

## Allowed scope

- Modify `tests/v01-step-recovery-closure.test.ts` only, plus test-local helpers if strictly necessary.
- Reuse existing production-valid atomic creation/service paths to build legal test data.
- Generate valid verification/review Evidence through existing services when practical instead of fabricating malformed records.

## Forbidden scope

- No product/source/runtime/workflow code changes.
- No schema, foreign-key, Evidence-correlation, or validation weakening.
- No test skip/filter/removal or assertion dilution.
- Do not redesign Recovery.

## Write ownership

- `tests/v01-step-recovery-closure.test.ts`
- `docs/workbench-coordination/todolist/TODO-RC-004.md`
- `docs/workbench-coordination/reports/REPORT-RC-004.md`

## Acceptance criteria

- The fixture establishes a schema-valid Project/Requirement/Plan/Stage/Step graph before recovery behavior runs.
- Catch-up Evidence satisfies the real Evidence correlation contract or is produced by the real verification/review services.
- All five tests execute through their intended recovery assertions instead of failing during fixture setup.
- The focused file passes with the unmodified product contracts.
- No Recovery invariant, Store validation, or Evidence provenance rule is weakened.

## Required validation

- Run `node --experimental-strip-types --test tests/v01-step-recovery-closure.test.ts`.
- Record total/pass/fail and any new business-level failures verbatim in the report.
- Run any directly affected fixture/store validation test needed to prove no validation bypass.

## Blocker / Unblock condition

None known.

## Attempt history

Fresh task created from external investigation finding B01. No RC-001 state is inherited.
