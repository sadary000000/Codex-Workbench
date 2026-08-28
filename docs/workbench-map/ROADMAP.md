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
| R5 — Native Runtime Dedup | `AUDIT_PASS` | R4 architecture boundary | Prove Codex-facing Workbench behavior is adapter/projection/product logic rather than a competing Thread/context/agent/tool runtime. | Satisfied by call-graph/persistence/runtime audit at `3a7c3509...`; no duplicate Native runtime change was justified. |
| R6 — Manual / Automation Decouple | `ACTIVE` | R5 | Ensure manual V1 remains usable without Automation and keep Workbench Project distinct from AutomationProject. | Manual execution path has no accidental Automation lifecycle dependency; product and Automation identities remain explicit. |
| R7 — Projection / Map | `PLANNED` | R6 | Build/refine the Workbench incremental Map over requirements, plans, workflow, changes, evidence, review, PRs, and native runtime references. | Map is useful for navigation and handoff while remaining a projection rather than execution truth. |
| R8 — Migration / Dead Code | `PLANNED` | R7 | Remove superseded wrappers, compatibility paths, and duplicate state after the target ownership model is proven. | Deprecated duplicate paths are migrated or deleted with tests/evidence; no second runtime survives accidentally. |
| A/B — Validation | `PLANNED` | R8 | Compare the resulting Workbench path with Codex-native behavior and evaluate whether Workbench additions provide measurable value. | Defined benchmark scenarios, reproducible evidence, and documented tradeoffs/results. |

`AUDIT_PASS` means a stage's ownership/exit condition was satisfied by evidence and no production edit was warranted. It is not merge approval.

## Delivery chain leading into this map

| PR | Slice | State | Head checkpoint |
| --- | --- | --- | --- |
| #2 | Planner retry/source-integrity | `MERGED` | Integrated before the current architecture stack. |
| #3 | Provider execution boundary | `STACKED_DRAFT` | `36477bcd75e7c43c3704575eb06fcd31da7a1bb3` |
| #4 | Query/reconcile boundary | `STACKED_DRAFT` | `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0` |
| #5 | Reconcile resource-truth fail-closed boundary | `STACKED_DRAFT` | `3f24f8ff904907e7538289c897c682427fca1208` |
| #6 | Native/provider-neutral policy budget durability | `STACKED_DRAFT` | `270e3de45bb07d4a9d5199a7cecb1c0058df4f10` |
| #7 | WebGPT policy budget durability | `STACKED_DRAFT` | `717069965d211189919ed081946a21d224b11353` |
| #8 | Initial Workbench handoff map | `STACKED_DRAFT` | `375206182e5ee436dd1eac4ddf9d60938f98c37d` |

`STACKED_DRAFT` means the slice has been prepared/validated but must not be interpreted as merge approval.

## R3 notes

R3 established the provider-side effect boundary around explicit action intent/attempt/request/receipt records, separated status query from mutation/reconciliation, and made reconciliation fail closed if its previously persisted resource correlation is missing. Crash-window audit also confirmed a dispatching intent cannot simply produce another blind resend.

## R4 notes

R4 preserves the frozen policy formula while making budget commitments restart-durable. Native/provider-neutral budget is committed at authorization because an unknown downstream outcome is not safely refundable. WebGPT durable commitment occurs as the last local step before browser/provider mutation.

## R5 result

R5 finished as an evidence-based pass rather than a refactor. The original handoff filenames were stale; the actual production audit covered `native-thread-runtime`, App Server Host/client topology, runtime registry, Native Automation provider adapters, read/persistence projections, composer/native options, renderer message projection, and Map maintenance paths.

Key conclusions:

- Native Thread/Turn/Item IDs and history come from Codex App Server.
- Workbench does not persist a second Native transcript.
- raw Prompt recovery text is process-local and stripped from durable persistence.
- Automation Native dispatch reuses an attached Native runtime and fails closed on a missing target.
- Composer approval/sandbox values are native protocol parameters, not a second executor.
- Map maintenance is a legitimate Workbench projection capability executed through real Codex Native Threads/Turns; isolated App Server processes are documented ABI/capability exceptions, not hidden ordinary user Thread truth.
- No separate Workbench agent runner, subagent runtime, or generic Native tool executor/registry was found in the audited source topology.

Detailed evidence: [`R5_NATIVE_RUNTIME_AUDIT.md`](./R5_NATIVE_RUNTIME_AUDIT.md).

## R6 active audit

R6 is now the continuation point. The first audit is not a type-cleanup exercise; it must prove whether normal manual Native usage accidentally depends on Automation startup/persistence and whether product `Project` identity ever collapses into `AutomationProject` identity.

Priority questions and source targets are recorded in [`R6_AUDIT_TARGETS.md`](./R6_AUDIT_TARGETS.md).

Do not manufacture an R6 code change if manual startup and project identity boundaries already satisfy the frozen rules. If a concrete dependency is found, fix one bounded dependency with a regression test.

## R7–R8 guardrail

Later cleanup should follow proof, not aesthetics. First establish the authoritative owner, then migrate callers, verify behavior, and only then remove obsolete representation. In particular, do not delete Workbench Map semantics because Codex has native planning: the two serve different responsibility domains.
