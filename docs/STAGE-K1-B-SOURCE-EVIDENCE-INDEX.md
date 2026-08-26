# STAGE-K1-B Source Evidence Index

| Area | Source | Evidence |
| --- | --- | --- |
| Candidate Validator | `src/automation/planner-validator.ts` | allowlisted normalization, exact Requirement correlation, dependency DFS, JIT and transition checks |
| Public export | `src/automation/index.ts` | Validator API is available without changing Planner Provider behavior |
| Deterministic tests | `tests/stage-k1-b-validator-jit.test.ts` | 11 pure tests, including positive and negative matrices and the promotion guard |
| K1-A domain types | `src/automation/types.ts` | existing PlanVersion/StageSpec/StepSpec and RequirementVersion fields reused as context |
| Persistence structural validation | `src/automation/schema.ts` | existing document/reference validator retained and not duplicated |
| Historical Planner transport | `src/automation/planner-contract.ts` | retained as historical transport contract; not used as K1-B persistence proof |
| K1-A baseline | `docs/STAGE-K1-A-REALITY-CHECK.md`, `docs/STAGE-K1-A-STAGE-REVIEW.md` | entry boundary and no-real-prompt baseline |

No browser profile, Cookie, Token, raw transcript, private API or user chat content is included in this index or the review package.
