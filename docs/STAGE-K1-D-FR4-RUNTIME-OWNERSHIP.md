# STAGE-K1-D FIX ROUND 4 — Runtime Ownership and Reconcile Boundary

Date: 2026-08-27
Disposition: `FIX_REQUIRED / BLOCKED_MISSING_CORRELATION`
Scope: existing Attempt #2 only; no new Planner prompt, Request, Attempt, Chat, rebind, Step, Verifier, Scheduler, or K2 transition.

## Conclusion

The outer K1-D Runner does not operate ChatGPT. It launches the packaged
Workbench, invokes the official Workbench CLI for readiness/status, and reads
the bounded evidence file. It contains no Playwright, Puppeteer, WebDriver,
Selenium, external CDP, tab/page/clipboard API, or direct ChatGPT navigation.

The actual WebGPT navigation, Page Probe execution, session state, Observer,
and Composer writes are owned by the Workbench Electron process. The normal
Planner smoke path still has a separate explicit `control auto` hand-off for
its legacy positive-smoke mode; the FIX ROUND 4 `STAGE_K1_D_RECONCILE_ONLY`
branch does not issue that command. Control acquisition for reconcile-only is
inside Workbench and occurs only after exact ActionIntent/Attempt #2
preconditions pass.

The real FIX ROUND 4 run loaded the exact Workbench Request and PLANNER Role
binding, then stopped before control or navigation because the current local
Automation database has no matching logical ActionIntent/Attempt #2/provider
external-reference chain. This is the required fail-closed result; the
Request Journal remains unchanged as `RECOVERY_REQUIRED`.

## Runtime chain

```text
scripts/stage-k1-d-real-planner-smoke.ts
  → packaged Codex Workbench V1.exe
  → src/main/main.ts startup flag STAGE_K1_D_RECONCILE_ONLY
  → startStageK1DReconcileOnly()
  → runStageK1DReconcileOnly()
  → PlannerProviderIntegrationService.reconcilePlannerRequest()
  → WebGptAutomationProviderPort.reconcile()
  → WebGptRoleSessionService.status()
  → WebGptRequestManager.requestStatus()/reconcileRequest()
  → WebGptWorkspace.openChatForAutomation()/getPageProbe()
  → Workbench-owned Electron WebContents/Page Adapter/Network Observer
  → ChatGPT Web
```

The final two recovery operations are reachable only when the exact current
request and Automation correlation are present. `runStageK1DReconcileOnly`
does not expose a submit, new-chat, retry, or Composer method in its typed
dependency surface. It calls `reconcileRequest` for the fixed Request ID and
the Planner integration only with the fixed Attempt #2 ID.

## Ownership table

| Layer | Process/object owner | Navigation | Page Probe | Observer | Composer write | External browser controller |
|---|---|---|---|---|---|---|
| FR4 outer Runner | Node orchestration process | none | none | none | none | none; official CLI/control socket only |
| Official CLI client | Workbench control client | none | none | none | none | authenticated Workbench control socket |
| Workbench `main.ts` | Electron main process | delegates to Workspace | delegates to Workspace | delegates to Workspace | delegates to Workspace | none outside Electron |
| `runStageK1DReconcileOnly` | Workbench Automation stage | no direct URL/page access | none | none | none | only fixed reconcile callbacks |
| Planner integration | Workbench Automation | none | none | none | none | provider-neutral boundary |
| `WebGptAutomationProviderPort` | Workbench provider seam | via Role/Request service | via Request service | via Request service | no direct DOM access | no external controller |
| `WebGptRoleSessionService` | Workbench role/session service | delegates to Request Manager | consumes returned state | none | `submit` is outside FR4 entry | none |
| `WebGptRequestManager` | Workbench request owner | calls Workspace for exact persisted target | calls Workspace probe | starts/stops Workspace observation | calls Workspace only on normal submit path | internal operation arbiter |
| `WebGptWorkspace` + Page Adapter | Workbench Electron renderer host | `webContents.loadURL` for exact target | `executeJavaScript` Page Probe | owns `WebGptNetworkObserver` | page adapter scripts/Electron input on normal submit | none outside Workbench |
| `WebGptNetworkObserver` | Workbench WebContents owner | none | none | internal Electron debugger Network events | none | internal only, not external CDP |
| ChatGPT Web | external service page | receives Workbench navigation | is probed in its WebContents | network events observed by Workbench | receives normal Workbench send only | no separate browser process |

## Fixed reconcile-only control boundary

The new Runner mode sets `STAGE_K1_D_RECONCILE_ONLY=1`, removes temporary
Automation/Request-directory overrides, sets positive retry authorization to
`0`, launches Workbench, polls `status`, and reads the evidence file. It does
not call `control auto` in this mode. The Workbench entry performs these steps
in order:

1. query the fixed Request ID from the existing Workbench Request Journal;
2. query the fixed PLANNER Role binding;
3. query the Automation snapshot and verify the exact logical request,
   Attempt #1, Attempt #2, provider request/observation refs, receipt, policy,
   target, and zero promotions;
4. stop with `BLOCKED_MISSING_CORRELATION` if any item is absent or mismatched;
5. only after that gate, acquire Workbench `AUTO_CONTROL` and call the exact
   Request Manager reconcile operation;
6. only after a stable terminal result, call the provider-neutral existing
   Attempt #2 reconcile path, then parse/K1-B/persist/restart/query as
   applicable.

The current run stopped at step 4. Therefore its `controlCalls=0` and
`reconcileCalls=0` facts are independently covered by the FR4 regression
tests, while the real evidence records the same blocked boundary.

## Search audit

The Runner source was searched for `browser`, `broswer`, `Playwright`,
`Puppeteer`, `WebDriver`, `Selenium`, `Edge`, `CDP`, `chatgpt.com`, `page.`,
`tab.`, `navigate`, and `clipboard`. No direct page/browser-control API is
present. The only debugger/CDP-like calls are the Workbench-internal
`webContents.debugger` calls in `WebGptNetworkObserver`; they are not callable
from the outer Runner.

The FR4 targeted test also asserts that the Runner has no these direct browser
API tokens and that the reconcile-only branch skips the positive-smoke control
handoff.

## Evidence and known blocker

The exact Request Journal record is consistent with Attempt #2:

- Request ID and provider-attempt idempotency are fixed and unique;
- PLANNER project/role and shared canonical Chat identity match the Role
  binding;
- prompt length/hash and provider semantic hash match the authoritative
  ledger;
- `sendStartedAt` is present, so `submittedAt=null` is not treated as
  `NOT_DISPATCHED`;
- state remains `RECOVERY_REQUIRED`, with no result path/hash/bytes.

The live Automation SQLite store has no exact `f4a70e74…` ActionIntent, no
`5de6027e…` Attempt #2, and no `8b129814…`/`d73334c9…` external-ref chain.
Consequently no same-attempt provider observation can be accepted, no result
can be attributed, and no Plan promotion is legal. Attempt #3 remains absent.
