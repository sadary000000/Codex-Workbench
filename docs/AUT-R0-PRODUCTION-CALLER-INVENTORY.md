# AUT-R0 Production Caller Inventory

Baseline commit: `0edcec5`

## Active provider-neutral composition

| Caller | Status | Evidence |
|---|---|---|
| `src/main/main.ts` `webgpt.requirement.start|draft|reconcile` | ACTIVE PRODUCTION ENTRY | The authenticated Control Plane invokes the shared `RequirementAutomationService` with the process-owned InputRef registry; this is an executable caller, not idle composition only. |
| `src/automation/requirement-service.ts` provider mode | ACTIVE | Accepts opaque `providerTargetRef`; registers and persists only InputRef metadata; dispatches through `RequirementProviderDispatch`. |
| `src/automation/requirement-provider-dispatch.ts` | ACTIVE | Owns Action ledger creation, pre-side-effect round correlation, provider submit/observe/reconcile, receipt and recovery boundary. |

## Paused/test-only seams retained for compatibility

| Caller | Classification | Reason |
|---|---|---|
| `src/automation/aut2-real-webgpt-gate.ts` | `PAUSED / TEST_ONLY` | Historical real-gate harness; direct legacy adapter path is fail-closed and is not the active provider-neutral production path. |
| `src/automation/requirement-webgpt-adapter.ts` | `LEGACY_READ_ONLY / TEST_ONLY` | URL-shaped binding adapter retained only for paused compatibility tests. |
| `src/automation/requirement-service.ts` legacy `webgpt` branch | `LEGACY_COMPATIBILITY` | Requires explicit bound `RequirementChatBinding`; no current-chat fallback; not used when provider-neutral composition is attached. |

## Boundary findings

- No active AUT-R0 provider dispatch accepts a URL-shaped target.
- No active provider dispatch reads a current page/current chat to discover a
  target.
- The legacy names remain visible in the paused compatibility inventory by
  design; they are not evidence of an executable active caller.
- The production Control Plane command is the only main-process caller for the
  active Requirement service; it does not instantiate the legacy adapter.
