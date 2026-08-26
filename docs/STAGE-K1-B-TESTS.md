# STAGE-K1-B Tests

## Deterministic coverage

`tests/stage-k1-b-validator-jit.test.ts` covers:

1. Valid three-stage JIT candidate and dependency normalization.
2. Duplicate Stage ID, key and ordinal.
3. Duplicate Step ID, key and ordinal.
4. Missing, self, duplicate and cyclic dependency.
5. Explicit forward dependency.
6. Current OUTLINE, multiple DETAILED and future DETAILED rejection.
7. Expanded future/non-current Step rejection.
8. Empty and vague Step objective/acceptance rejection.
9. Exact project, RequirementVersion, status and SHA-256 checks.
10. `PLANNING_NEEDS_REQUIREMENT_INPUT` versus `VALID_WITH_ASSUMPTIONS`.
11. Runtime/provider/shell field rejection.
12. Plan predecessor/version validation and immutable predecessor snapshot.
13. Existing Plan ID collision.
14. Input/context purity.

## Negative assurance

No test invokes a Provider, WebGPT page, Executor, Native Thread, Step runtime, or real Prompt. The test file uses only in-memory candidate/context fixtures and the pure validator API.

The final targeted run is **11/11 PASS**. It includes the
`requireValidatedPlanCandidate` fail-closed handoff, Plan ID reuse and
predecessor lineage checks, invalid ambiguity normalization, and Stage-level
actionability checks added after the independent challenge.
