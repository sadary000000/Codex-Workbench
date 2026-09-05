# REPORT-RC-004

## Result

RC-004 fixture repair is implemented on the active `fix/v01-recovery-closure` branch, but the task is **not accepted as complete** because the required focused Node test could not be executed in the current environment.

## Owner assignment

The owner directly assigned RC-004 to the current ChatGPT conversation after discontinuing automatic Worker self-claim assignment. The prior `worker-v6` assignee value was legacy coordination state and is superseded for this attempt.

## Implementation commit

`992f22a24ad8c6a4e479812fb8c850e8ac6d4669` — `test: repair RC-004 recovery fixture validity`

Changed file only:

- `tests/v01-step-recovery-closure.test.ts`

No product/source/runtime/workflow file was modified.

## Changes

1. Plan fixture creation no longer points `currentStageId` at a StageSpec that has not been created yet:

```diff
-    currentStageId: STAGE_ID,
+    currentStageId: null,
```

This preserves Store/schema validation. Once the Stage exists, Governance already has the production fallback to the first active Stage when no initial Stage pointer is present.

2. The persisted verification Evidence at the crash boundary now has a valid bounded correlation identity:

```diff
       correlation: {
         workflowActionId: null,
-        requestId: null,
+        requestId: "v01-step-recovery-verification-crash-boundary",
```

The real `createEvidenceCorrelation()` contract accepts a bounded opaque `requestId` and rejects only an entirely empty identity/reference set. Schema reference validation does not treat `requestId` as a fabricated entity foreign key.

The review Evidence already carries `evidenceRefs: [verificationEvidenceId]`, so it was not changed.

## Evidence used

The owner-supplied Pro investigation established:

- original focused Recovery file: 5 tests / 0 pass / 5 fail because `PlanVersion.currentStageId` referenced a missing StageSpec;
- diagnostic copy with only `currentStageId: null`: 5 tests / 4 pass / 1 fail;
- the sole remaining failure occurred before the intended catch-up assertion because the verification Evidence correlation was entirely empty and threw `EVIDENCE_CORRELATION_INVALID`;
- an independent positive control using valid verification/review Evidence completed `VERIFYING -> REVIEWING -> TERMINAL / COMPLETED` without duplicate Evidence.

The current patch addresses exactly those two fixture-contract blockers and does not change Recovery product behavior.

## Required validation

Required command:

```sh
node --experimental-strip-types --test tests/v01-step-recovery-closure.test.ts
```

Status: **NOT RUN on commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669`**.

Current execution limitations verified during this attempt:

- no checked-out Workbench repository is present in the execution container;
- direct GitHub clone/fetch from the container fails DNS resolution (`Could not resolve host: github.com`);
- the repository CI workflow does not auto-run on `fix/v01-recovery-closure`; its push/PR triggers target `codex/workbench-v1` and `workbench/next`;
- the available GitHub connector exposes reading/rerunning existing workflow runs but not creation of a new `workflow_dispatch` run;
- no workflow run/status exists yet for commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669`.

No unsafe helper branch, CI carrier branch, PR retarget, validation weakening, or fabricated PASS was used to work around this limitation.

## Blocker / Unblock condition

Blocker: the required focused test has not actually run against the patched commit.

Unblock condition: execute the required Node 22 focused command against exact commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669` (or a descendant with the same RC-004 test content) in a dependency-ready checkout / exact-ref CI environment and obtain 5/5 PASS. If a business-level failure remains, preserve it verbatim and continue RC-004 rather than marking DONE.

## Scope check

PASS for implementation scope:

- only the permitted Recovery test file changed;
- Store/schema/Evidence validation remains intact;
- no test was skipped, removed, or diluted;
- no Recovery runtime/product behavior was changed;
- no external side effect was repeated.
