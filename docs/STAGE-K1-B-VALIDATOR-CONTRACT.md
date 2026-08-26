# STAGE-K1-B Validator Contract

## Contract

`validatePlanCandidate(value, context)` 是唯一的 Candidate semantic validation 入口。它接收不可信的 `unknown` 候选和只读的 Requirement/Plan context，返回机器可读的 `PlanValidationResult`；不会写 Store、调用 Provider、创建 runtime、切换 active pointer 或修复输入。

```text
unknown PlanCandidate
        |
        v
normalizePlanCandidate (pure, allowlist, bounded)
        |
        v
structural + dependency + JIT + step + transition checks
        |
        v
PlanValidationResult
```

`PlanCandidate` 与 `PlanVersion` 是不同类型：Candidate 没有 lifecycle status、createdAt、active authority、executor、browser、shell、provider、nativeThread 或 raw Requirement 内容。

`requireValidatedPlanCandidate(value, context)` is the explicit future
promotion handoff guard. It rejects `INVALID` and
`PLANNING_NEEDS_REQUIREMENT_INPUT`; only an accepted result may cross into a
future persistence command. The guard does not persist, activate, or mutate
the active Plan pointer.

## Required candidate fields

- Plan identity: `planVersionId`, `projectId`, `version`, `supersedes`。
- Exact Requirement binding: `requirementVersionId`, `requirementPayloadSha256`。
- JIT pointer: `currentStageId`。
- Stage list: unique `stageSpecId`/`stageKey`/`ordinal`，name/objective/acceptance/detail/assumptions/risks and lineage fields。
- Step list: unique IDs/keys/ordinal, owning stage, objective, typed inputs/expectedOutputs/acceptance/assumptions/constraints and bounded domain metadata。

Unknown fields are rejected by allowlists. This includes `nativeThreadId`, `browser`, `shell`, `provider`, `runtime`, `executor`, `subagent`, `process`, `runtimeHandle`, `prompt`, `transcript`, `canonicalRequirementPayload` and similar execution/second-truth fields.

## Result semantics

| status | `valid` | meaning |
| --- | --- | --- |
| `VALID` | true | Candidate is structurally and semantically valid without assumptions |
| `VALID_WITH_ASSUMPTIONS` | true | Candidate is valid, but explicitly listed non-blocking assumptions must remain visible |
| `PLANNING_NEEDS_REQUIREMENT_INPUT` | false | Candidate is otherwise parseable but has blocking questions or missing Requirement fields |
| `INVALID` | false | Structural, identity, dependency, JIT, step, or version rule failed |

The result always exposes `issues`, `errors`, `warnings`, `blockingQuestions`, `missingRequirementFields`, `assumptions`, and a normalized candidate only when the candidate is accepted. Invalid and requirement-blocked results have `normalizedCandidate: null`.
