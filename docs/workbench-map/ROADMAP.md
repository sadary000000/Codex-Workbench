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
| R5 — Native Runtime Dedup | `AUDIT_PASS` | R4 architecture boundary | Prove Codex-facing Workbench behavior is adapter/projection/product logic rather than a competing Thread/context/agent/tool runtime. | Satisfied by call-graph/persistence/runtime audit; no duplicate Native runtime change was justified. |
| R6 — Manual / Automation Decouple | `AUDIT_PASS` | R5 | Ensure manual V1 remains usable without Automation and keep Workbench Project distinct from AutomationProject. | Ordinary manual startup/execution is Automation-independent and the two Project domains have separate persisted owners/identities. |
| R7 — Projection / Map | `ACTIVE` | R6 | Refine the Workbench incremental Map over governance and runtime references without making it another truth owner. | Map reads/references authoritative domains, owns only projection state, keeps context bounded, and exposes useful Workbench-specific navigation/governance links. |
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

## R5 result

R5 finished as an evidence-based pass rather than a refactor. Native Thread/Turn/Item truth comes from Codex App Server; Workbench keeps only bounded controller/recovery/product projection state. No durable duplicate transcript, second agent/subagent runtime, generic Native tool executor, or second sandbox/approval runtime was found.

Detailed evidence: [`R5_NATIVE_RUNTIME_AUDIT.md`](./R5_NATIVE_RUNTIME_AUDIT.md).

## R6 result

R6 also finished as an evidence-based pass.

Key conclusions:

- ordinary GUI startup is explicitly idle with respect to Automation/WebGPT persistence unless an explicit gate/command activates it;
- regression tests verify no Automation store/files/control-plane artifacts appear on ordinary startup;
- manual `native-runtime:*` IPC routes directly to `NativeThreadRuntime` without Workflow/Requirement/Plan prerequisites;
- product `ProjectRecord` lives in V1 Workbench persistence and normally gets its identity from that store;
- `AutomationProject` lives in independent `automation.db`, owns workflow lifecycle/governance refs, and must already exist for Requirement/Planner operations;
- Automation's legacy `WORKBENCH_PROJECT` ExternalRef kind is serialization carrier vocabulary for provider workflow scope, not ownership of the V1 Product Project;
- no automatic Product Project -> AutomationProject identity collapse was found.

Detailed evidence: [`R6_MANUAL_AUTOMATION_AUDIT.md`](./R6_MANUAL_AUTOMATION_AUDIT.md).

## R7 active audit

R7 is now the continuation point. Map is deliberately retained as a Workbench-specific projection/governance capability, so the audit starts from ownership and usefulness:

- prove Map cannot rewrite Native/Workflow/provider/resource truth;
- prove context reads are bounded and do not accumulate a second transcript;
- verify maintenance uses real Codex Native execution with narrow Map tools;
- inspect stale/unavailable projection behavior;
- identify concrete missing links between Requirement/Plan/Workflow/Change/Evidence/Review/PR/commit/native/provider/resource entities that improve Workbench navigation without duplicating Codex-native planning.

Priority questions and source targets are in [`R7_AUDIT_TARGETS.md`](./R7_AUDIT_TARGETS.md).

## R8 guardrail

Later cleanup should follow proof, not aesthetics. First establish the authoritative owner, then migrate callers, verify behavior, and only then remove obsolete representation. In particular, do not delete Workbench Map semantics because Codex has native planning: the two serve different responsibility domains.
