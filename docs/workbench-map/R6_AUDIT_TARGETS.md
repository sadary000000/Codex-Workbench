# R6 Manual / Automation Decouple Audit Targets

`R6 — Manual / Automation Decouple` starts only after the R5 Native Runtime audit passed without a production code change.

The frozen product rules are:

1. Manual V1 must remain usable independently of Automation.
2. Workbench `Project` is a product/navigation shell and must remain distinct from `AutomationProject`.
3. Reusing Native Runtime infrastructure is allowed; inheriting Automation lifecycle, policy, database availability, or workflow identity is not.

## Primary audit questions

### Startup independence

- Does normal Electron startup require the Automation database/composition to initialize before manual Native Thread UI becomes usable?
- If Automation persistence fails or is unavailable, does the manual Native runtime fail unnecessarily?
- Are Automation-only gates/smokes isolated from the normal manual startup path?
- Can Automation be initialized lazily when an Automation feature is actually invoked without weakening explicit provider/policy boundaries?

Primary surfaces:

- `src/main/main.ts`
- `src/main/startup-policy.ts`
- `src/automation/composition-root.ts`
- `src/automation/production-path-contract.ts`

### Project identity separation

- Is `ProjectRecord.projectId` used only for the Workbench product shell/navigation binding?
- Is `AutomationProject.projectId` created/owned by Automation persistence rather than silently reusing or coercing the product Project identity?
- Where the two domains need correlation, is it an explicit reference/binding rather than type collapse or implicit equality?
- Do provider/requirement/planner workflows receive Automation project identity from Automation truth rather than from the currently selected manual Project by accident?

Primary surfaces:

- `src/shared/persistence-store.ts`
- `src/automation/schema.ts`
- `src/automation/store.ts`
- provider/requirement/planner composition and binding code where project scope crosses domains.

### Manual execution path

- Do manual `thread/start`, `thread/resume`, `thread/read`, `turn/start`, approval, interrupt, and composer capability paths call the Native runtime directly rather than passing through Automation workflow state?
- Does manual operation remain possible when no `AutomationProject`, Workflow, RequirementVersion, or PlanVersion exists?
- Are shared provider/runtime adapters one-way composition for Automation rather than a reverse dependency from Manual into Automation?

Primary surfaces:

- `src/main/main.ts`
- `src/codex/native-thread-runtime.ts`
- `src/main/runtime-registry.ts`
- `src/main/native-provider-runtime-adapter.ts`

## Classification

Use the same evidence-first rule as R5:

- `MANUAL_INDEPENDENCE_PASS` — Manual path has no required Automation lifecycle dependency.
- `IDENTITY_BOUNDARY_PASS` — Product Project and AutomationProject remain distinct with explicit correlation only.
- `DECOUPLE_CHANGE` — a concrete production dependency/identity collapse is proven and needs a bounded migration.
- `NEEDS_EVIDENCE` — callers/lifecycle cannot yet establish ownership safely.

Do not split types or add adapters merely for aesthetic symmetry. A code change is justified only by an actual dependency or identity-owner violation.
