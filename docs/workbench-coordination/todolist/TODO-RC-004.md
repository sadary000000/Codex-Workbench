# TODO-RC-004

Status: `BLOCKED`
Assignee: `manual-chatgpt`
Priority: `P0`
Latest report: `docs/workbench-coordination/reports/REPORT-RC-004.md`

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

Blocker: implementation commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669` repairs both known fixture-contract blockers, but the required focused Node test has not run against that commit. The current execution container has no Workbench checkout and cannot resolve `github.com`; the current CI workflow does not auto-run for `fix/v01-recovery-closure`, and the available GitHub connector cannot create a new workflow-dispatch run.

Unblock condition: in a dependency-ready checkout or exact-ref CI environment, run Node 22 command `node --experimental-strip-types --test tests/v01-step-recovery-closure.test.ts` against exact commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669` (or a descendant with identical RC-004 test content) and obtain all five tests PASS. Preserve any remaining business-level failure verbatim instead of weakening validation.

## Attempt history

- Attempt 1 — legacy claim `worker-v6`, superseded when the owner discontinued automatic Worker self-claim assignment.
- Attempt 2 — owner directly assigned RC-004 to the current ChatGPT conversation (`manual-chatgpt`).
  - implementation commit: `992f22a24ad8c6a4e479812fb8c850e8ac6d4669`
  - changed only `tests/v01-step-recovery-closure.test.ts`
  - repair: initial Plan fixture uses `currentStageId: null`; verification crash-boundary Evidence uses bounded opaque `requestId`
  - external pre-fix evidence: first repair alone produced 4/5 PASS with the remaining failure exactly `EVIDENCE_CORRELATION_INVALID`; valid-Evidence catch-up positive control passed
  - required focused validation on patched commit: NOT RUN due verified execution/CI availability blocker
  - report: `docs/workbench-coordination/reports/REPORT-RC-004.md`

Fresh task created from external investigation finding B01. No RC-001 state is inherited.
