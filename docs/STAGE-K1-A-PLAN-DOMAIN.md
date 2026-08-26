# STAGE-K1-A Plan Domain

## Scope

This document records the additive Plan domain delivered in STAGE-K1-A. It does not authorize a Planner provider, a validator, an executor, or a WebGPT smoke test.

## Durable model

```text
RequirementVersion (exact, project-scoped, active/confirmed)
        |
        +--> PlanVersion (immutable definition)
                |
                +--> StageSpec (immutable definition, ordered)
                        |
                        +--> StepSpec (immutable definition, ordered)
                                |
                                +--> StepRuntime (existing K0 execution projection)

AutomationProject.activePlanVersionId --> PlanVersion
```

`PlanVersion` stores the exact `requirementVersionId` and the requirement payload hash observed at creation. It also records bounded `createdBy` / `origin` provenance and may carry the optional `currentStageId`; schema reference validation requires that the stage belongs to the same plan.

## PlanVersion

The persisted shape includes `planVersionId`, `projectId`, `requirementVersionId`, `version`, `status`, predecessor lineage, timestamps, and the existing optional planning metadata. K1-A adds the explicit `currentStageId` pointer and preserves the requirement hash. A new plan is accepted only when the referenced RequirementVersion belongs to the project, is the project's exact active RequirementVersion, and is `ACTIVE` or `CONFIRMED`.

New versions are inserted with an explicit immediate predecessor. `createPlanVersion` never rewrites the predecessor. Generic transaction replacement rejects changes to the PlanVersion definition, including status, provenance, and `currentStageId`; active selection is a separate project-pointer mutation. A project pointer can select only an `ACTIVE` plan bound to the project's exact active `RequirementVersion` and matching requirement hash.

## StageSpec

The canonical fields are `stageSpecId`, `planVersionId`, `stageKey`, `name`, `objective`, `dependsOn`, `acceptanceCriteria`, `detailLevel`, `assumptions`, `risks`, `specVersion`, `ordinal`, timestamps, and predecessor lineage. `goal` remains an equal legacy alias for compatibility. K1-A persists bounded values and the `OUTLINE | DETAILED` enum but does not judge dependency cycles or semantic quality.

## StepSpec

The canonical fields are `stepSpecId`, `stageSpecId`, `stepKey`, `specVersion`, `kind`, stable `ordinal`, `objective`, `inputs`, `expectedOutputs`, `acceptanceCriteria`, `assumptions`, `constraints`, risk/side-effect classification, timestamps, and predecessor lineage. `goal` remains an equal compatibility alias. Execution identity and state remain in the existing `StepRuntime`; no native thread, process, browser selector, or executor field is added to `StepSpec`.

## Active selection

`setActivePlanVersion(projectId, planVersionId)` validates project ownership, `ACTIVE` status, and exact current RequirementVersion binding, then updates only `AutomationProject.activePlanVersionId` and its audit event. `getCurrentPlanVersion` reads that pointer without creating, repairing, migrating, or dispatching anything.

## Compatibility boundary

The historical `persistPlannerPlan` path is retained for K0/AUT-3 regression compatibility and fills the new additive fields with bounded defaults. Its predecessor-status capability is module-private and cannot be invoked through the public transaction surface; the K1-A create/query path never rewrites a PlanVersion. Full Planner integration remains deferred.
