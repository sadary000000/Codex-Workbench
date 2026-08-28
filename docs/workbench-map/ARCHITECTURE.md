# Architecture Boundary Map

This file captures the current architecture boundaries that should survive session handoff. It is intentionally narrower than a full system design document: its job is to prevent future work from accidentally rebuilding capabilities that already belong to Codex native runtime.

## Direction

Codex-Workbench is not a replacement runtime for Codex. The project should use Codex native capabilities wherever they exist, add only the Workbench-specific product and governance semantics that are missing, and remove or retire duplicate wrappers over time.

The preferred execution path is therefore:

`Workbench product/governance -> Codex native Harness/Runtime -> native tools/provider boundary`

not:

`Workbench pseudo-runtime -> duplicated agent/context/tool/sandbox state -> Codex`

## Responsibility map

| Domain | Authoritative owner | Workbench responsibility |
| --- | --- | --- |
| Thread / Turn / Item execution | Codex App Server | Reference/project and present native execution; do not duplicate transcript truth. |
| Context and native agent/subagent execution | Codex native runtime | Add product-level selection/governance only where native semantics are insufficient. |
| Tools, sandbox, approvals, diff/runtime events, recovery | Codex native runtime | Adapt native protocol and expose UX/governance; do not create a second runtime. |
| Project product shell | Workbench | Own project-level product metadata and navigation distinct from automation execution. |
| RequirementVersion / PlanVersion | Workbench | Own immutable governance/version truth. |
| Workflow / Stage / Step | Workbench automation persistence | Own workflow progression and governance state. |
| Automation policy | Workbench | Persist `PolicyVersion`; derive effective authorization using runtime capability and hard constraints. |
| External actions | Provider/remote plus Workbench reconciliation records | Persist intent/attempt/request/receipt correlation; reconcile unknown outcomes instead of blind resend. |
| Runtime resources | Live resource ownership/lease mechanism | Persist correlation/projection where useful; do not let Evidence or UI become the resource owner. |
| Evidence / Audit | Workbench | Record evidence and governance history without taking ownership of workers/resources. |
| Map / UI projection | Workbench | Project requirements, plans, workflow, changes, evidence, review, PRs, and runtime references into navigable structure. |

## Truth domains

The architecture deliberately has multiple truths because they describe different domains. Do not collapse them into one generic state table.

### Native Runtime Truth

Codex App Server owns the actual execution model: `Thread`, `Turn`, `Item`, native context, agent/subagent behavior, tool execution, sandbox, approvals, native plan, diff/runtime events, and runtime recovery.

Workbench may persist stable identifiers or projections needed for product navigation, but a projection must never outrank native execution state.

### Workflow Truth

Workbench automation persistence owns `Workflow`, `Stage`, `Step`, and related governance progression. This is product/workflow truth, not a transcript of Codex execution.

### External Action Truth

For side effects performed through a provider, the provider/remote system is authoritative about what actually happened. Workbench owns durable intent, attempt, request, receipt, and reconciliation records.

An unknown provider outcome must enter reconciliation. Never blindly resend a potentially side-effecting action because a local response was lost.

### Resource Truth

Live runtime ownership/lease state is authoritative for scarce resources. Evidence, audit records, provider request correlation, and UI projections may refer to a resource claim or lease but must not impersonate the resource manager.

### Projection Truth

Workbench Map/UI and this directory are derived navigation surfaces. They help humans and agents understand relationships and checkpoints; they do not create execution truth.

## Effective policy

The effective runtime policy is derived, not independently persisted as a second policy object:

`EffectivePolicy = persisted PolicyVersion + hard constraints + runtime capability`

A provider/runtime adapter may evaluate this result, but it should not create another competing policy authority.

## Frozen invariants

The following invariants should be treated as architectural constraints unless explicitly reopened by a deliberate architecture decision:

1. Native `Thread` / `Turn` / `Item` are the execution truth.
2. Workbench must not persist a duplicate transcript as an alternative execution history.
3. Manual V1 operation must remain independently usable from Automation.
4. Workbench Project product shell is distinct from `AutomationProject`.
5. `RequirementVersion` and `PlanVersion` remain Workbench governance truth.
6. Unknown external side effects must reconcile rather than blind resend.
7. WebGPT exact-target actions fail closed when the target cannot be proven.
8. Evidence/Audit are separate from worker/resource ownership.
9. Map is a Workbench incremental capability and must not be deleted merely because Codex has a native plan.
10. Workbench must not implement a second sandbox, tool runtime, or subagent runtime.

## Change rule

If future implementation appears to conflict with one of these invariants, stop treating the conflict as an ordinary refactor. Record the proposed architecture change, its reason, affected truth domain, migration impact, and evidence before changing the invariant.
