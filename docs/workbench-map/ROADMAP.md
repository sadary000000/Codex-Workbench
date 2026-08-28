# Workbench Engineering Roadmap

This is the human-readable stage map for the current Native-first architecture migration. It records ordering and exit conditions, not runtime execution state.

## Route

`R3 Resource & External Action -> R4 Policy & Evidence -> R5 Native Runtime Dedup -> R6 Manual/Automation Decouple -> R7 Projection/Map -> R8 Migration & Dead Code -> A/B Validation`

Each stage should reduce ambiguity before the next stage starts. A later stage may be audited while earlier stacked work is waiting for merge approval, but implementation must preserve the dependency chain.

## Stage map

| Stage | Status | Depends on | Goal | Exit condition |
| --- | --- | --- | --- | --- |
| R3 — Resource & External Action | `STACKED_DRAFT` | R2 provider boundary | Make provider side effects explicit, query/reconcile separated, and resource correlation fail closed. | No hidden reconcile switch; unknown outcomes reconcile; missing resource truth cannot be fabricated. |
| R4 — Policy & Evidence | `STACKED_DRAFT` | R3 | Keep one persisted policy truth while making authorization/budgets durable across process restart; preserve Evidence/Audit separation. | Native/provider-neutral and WebGPT policy budgets survive restart without introducing a second policy database or refunding unknown side effects. |
| R5 — Native Runtime Dedup | `ACTIVE` | R4 architecture boundary | Audit and remove pseudo-Codex runtime behavior around Thread/context/agent/tools while retaining legitimate Workbench projection/governance. | `src/codex/**` is demonstrably adapter/projection/product logic rather than a competing Thread/context/agent/tool runtime. |
| R6 — Manual / Automation Decouple | `PLANNED` | R5 | Ensure manual V1 remains usable without Automation and keep Workbench Project distinct from AutomationProject. | Manual execution path has no accidental automation lifecycle dependency; product and automation identities remain explicit. |
| R7 — Projection / Map | `PLANNED` | R6 | Build the Workbench incremental Map over requirements, plans, workflow, changes, evidence, review, PRs, and native runtime references. | Map is useful for navigation and handoff while remaining a projection rather than execution truth. |
| R8 — Migration / Dead Code | `PLANNED` | R7 | Remove superseded wrappers, compatibility paths, and duplicate state after the target ownership model is proven. | Deprecated duplicate paths are migrated or deleted with tests/evidence; no second runtime survives accidentally. |
| A/B — Validation | `PLANNED` | R8 | Compare the resulting Workbench path with Codex-native behavior and evaluate whether Workbench additions provide measurable value. | Defined benchmark scenarios, reproducible evidence, and documented tradeoffs/results. |

## Completed delivery chain leading into this map

The current work is intentionally stacked so each architectural slice can be reviewed independently.

| PR | Slice | State | Head checkpoint |
| --- | --- | --- | --- |
| #2 | Planner retry/source-integrity | `MERGED` | Integrated before the current architecture stack. |
| #3 | Provider execution boundary | `STACKED_DRAFT` | `36477bcd75e7c43c3704575eb06fcd31da7a1bb3` |
| #4 | Query/reconcile boundary | `STACKED_DRAFT` | `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0` |
| #5 | Reconcile resource-truth fail-closed boundary | `STACKED_DRAFT` | `3f24f8ff904907e7538289c897c682427fca1208` |
| #6 | Native/provider-neutral policy budget durability | `STACKED_DRAFT` | `270e3de45bb07d4a9d5199a7cecb1c0058df4f10` |
| #7 | WebGPT policy budget durability | `STACKED_DRAFT` | `717069965d211189919ed081946a21d224b11353` |

`STACKED_DRAFT` means the implementation slice has been prepared and validated but must not be interpreted as merge approval.

## R3 notes

R3 established the provider-side effect boundary around explicit action intent/attempt/request/receipt records, separated status query from mutation/reconciliation, and made reconciliation fail closed if its previously persisted resource correlation is missing.

A crash window was also audited: once an action attempt transitions its intent out of dispatch eligibility, a retry cannot simply create another attempt and blindly resend the same side effect. Resource-globalization was not added merely for abstraction symmetry; provider-specific live resource ownership remains provider/runtime truth.

## R4 notes

R4 preserves the frozen policy formula while making budget commitments restart-durable.

For Native/provider-neutral authorization, budget consumption is committed at authorization because an unknown downstream outcome is not safely refundable. For WebGPT, durable commitment occurs as the last local step before the browser/provider mutation so safe pre-dispatch failures can still release their reservation, while a post-commit unknown outcome cannot regain budget after restart.

## R5 active audit

R5 is the current continuation point. Audit production call graphs before deleting anything based on filenames alone.

Priority surfaces:

- `src/codex/project-thread-store.ts` — determine whether persisted data is legitimate Workbench project-to-native-thread mapping/projection or duplicate Thread execution truth.
- `src/codex/context-sharing.ts` — determine whether it references native context/turns or reconstructs a competing context/transcript.
- `src/codex/agent-run-service.ts` — determine whether it is a thin App Server orchestration adapter or a pseudo agent/subagent runtime.
- `src/codex/tool-registry.ts` — determine whether it is UI/tool metadata/adaptation or a second native tool registry/execution/permission system.
- `src/codex/composer-capabilities.ts` and adjacent native protocol adapters — preserve thin native turn-option adaptation; remove only duplicate runtime semantics proven by call-graph evidence.

Do not manufacture an R5 code change merely to advance the roadmap. An audited PASS is a valid result when a component is already a thin native adapter or legitimate Workbench projection.

## R6–R8 guardrail

Later cleanup should follow proof, not aesthetics. First establish which owner is authoritative, then migrate callers, verify behavior, and only then remove the obsolete representation. In particular, do not delete Workbench Map semantics because Codex has native planning: the two serve different responsibility domains.
