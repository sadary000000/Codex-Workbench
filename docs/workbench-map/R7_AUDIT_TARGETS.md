# R7 Projection / Map Audit Targets

`R7 — Projection / Map` starts after R5 and R6 both satisfied their exit conditions without requiring production refactors.

The frozen rule is:

> Map is a Workbench incremental projection/governance capability. It must not be deleted merely because Codex has native planning, and it must not become a second runtime/workflow source of truth.

## Primary audit questions

### Projection ownership

- What data is authoritative in `MapStore`, and what data is copied only as bounded projection/reference?
- Can a Map mutation directly rewrite Native Thread/Turn/Item truth, Automation Workflow truth, provider truth, or live resource ownership?
- Are stale Map records repaired from their authoritative domains rather than used to overwrite those domains?

Primary surfaces:

- `src/map/map-store.ts`
- `src/map/map-types.ts`
- `src/main/map-coordinator.ts`
- `src/main/project-map-manager.ts`
- Map IPC/renderer projection paths.

### Context boundaries

- How does Conversation Map obtain current Thread context?
- How does Project Map read member Thread context?
- Are context reads bounded and read-only, or does Map accumulate an unbounded second transcript/document store?
- Are prompt/model outputs used as maintenance inputs kept separate from authoritative Native history?

Primary surfaces:

- `src/main/map-coordinator.ts`
- `src/main/project-map-manager.ts`
- `src/codex/map-tool.ts`
- Native `thread/read` adapters used by Map.

### Maintenance execution

- Are Map maintenance actions executed through real Codex Native Threads/Turns rather than a private pseudo-agent runtime?
- Are hidden/ephemeral maintenance Threads explicitly scoped and excluded from ordinary user Thread identity?
- Do dynamic tools expose only Map projection mutations rather than generic filesystem/tool execution?
- Are current isolated App Server process exceptions capability/ABI boundaries rather than accidental duplicate ordinary runtime trunks?

### Governance linkage

- Can Map represent RequirementVersion, PlanVersion, Workflow/Stage/Step, Change Request, Evidence/Review, PR/commit, Native Thread/Turn, provider action, and resource references without claiming ownership of those entities?
- Are cross-domain links explicit references with owner/type information rather than duplicated mutable objects?
- Is there a clear path for stale/unknown/unavailable projections?

### Product usefulness

- Does current Map actually expose a useful navigation/progress/handoff model, or is it only internal maintenance plumbing?
- Which missing links are genuine Workbench product increments versus duplicated Codex-native plan/status UI?
- Can the handoff-map documentation eventually project into the product Map without turning docs into runtime truth?

## Classification

For each audited surface classify as one of:

- `PROJECTION_BOUNDARY_PASS` — reads authoritative domains and owns only Map projection state.
- `MAP_INCREMENT_PASS` — legitimate Workbench product/governance capability not supplied by Codex Native.
- `PROJECTION_LEAK_CHANGE` — Map is proven to own/mutate truth belonging to another domain or to persist an unsafe duplicate.
- `MAP_PRODUCT_GAP` — ownership is correct but a concrete missing Workbench projection/navigation link is worth implementing.
- `NEEDS_EVIDENCE` — callers/persistence/runtime behavior are not yet clear.

A production change is justified only for a concrete `PROJECTION_LEAK_CHANGE` or a bounded `MAP_PRODUCT_GAP`. Do not delete Map semantics simply to reduce code count.
