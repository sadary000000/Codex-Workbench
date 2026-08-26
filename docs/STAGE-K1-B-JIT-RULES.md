# STAGE-K1-B JIT Rules

## Stage detail

- `currentStageId` is mandatory and must identify a candidate Stage.
- The current Stage must be `DETAILED`.
- Exactly one Stage may be `DETAILED`.
- Every other Stage must be `OUTLINE`; a detailed future Stage is rejected.
- No Step may belong to a non-current Stage. In particular, a future OUTLINE Stage cannot contain expanded Steps.
- Current Stage acceptance criteria are required.

## Detailed Steps

The current Stage must contain at least one ordered Step. Each Step requires:

```text
objective
inputs
expectedOutputs
acceptanceCriteria
assumptions
constraints
```

The lists are bounded string lists. Objective and acceptance entries that are only vague commands such as “完成一下”, “优化一下”, “检查所有问题”, or “do it” are rejected as non-machine-verifiable. The rule does not attempt to infer business meaning from a good, specific sentence.

## Version transition

- A first candidate is version 1 with `supersedes: null`.
- A candidate with a current Plan predecessor must be exactly `previous.version + 1` and supersede exactly `previous.planVersionId`.
- The predecessor must be ACTIVE and remain immutable.
- The candidate keeps the exact project and RequirementVersion identity.
- Validation never persists a new PlanVersion and never changes `activePlanVersionId`; activation remains an explicit command boundary.

## Lineage and actionability hardening

Candidate Plan IDs cannot be reused. A successor must reference the exact
previous Plan ID, increment the version by one, preserve the exact
Requirement hash, and use the supplied predecessor Stage/Step identity
snapshots. Stage and Step predecessor IDs cannot silently point at another
key, plan, or version. Stage objective and acceptance text are also checked
for the same bounded, actionable language as Steps. If ambiguity is blocking,
validation returns `PLANNING_NEEDS_REQUIREMENT_INPUT` with no normalized
candidate; it cannot be promoted accidentally.
