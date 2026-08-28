# R5 Native Runtime Dedup Audit

## Result

`R5 — Native Runtime Dedup` is an `AUDIT_PASS` at source checkpoint `3a7c3509b7fff16fb10a2b598aa6a20c857cd7b6`.

No production code change was justified by this audit. The current Codex-facing path already keeps `Native Thread`, `Native Turn`, and `Native Item` as Codex App Server truth. Workbench keeps bounded controller state, product metadata, recovery correlation, UI projections, provider correlation, and Map state without persisting a competing Native transcript or implementing a second Codex tool/sandbox/subagent runtime.

`AUDIT_PASS` means the stage exit condition was satisfied by evidence rather than by manufacturing a refactor. It does not imply that the earlier stacked Draft PRs are approved for merge.

## Handoff correction

The original R5 handoff target list was stale. These files do not exist at the audited source checkpoint:

- `src/codex/project-thread-store.ts`
- `src/codex/context-sharing.ts`
- `src/codex/agent-run-service.ts`
- `src/codex/tool-registry.ts`

The actual production surfaces are concentrated in `src/codex/native-thread-runtime.ts`, App Server host/client adapters, `src/main/runtime-registry.ts`, Native provider adapters, read/projection code, and the explicit Map maintenance paths.

Never infer architecture from a stale filename list. Remote Git plus production callers are authoritative for the code topology.

## Evidence matrix

| Surface | Classification | Evidence / ownership conclusion |
| --- | --- | --- |
| `src/codex/native-thread-runtime.ts` | `NATIVE_ADAPTER_PASS` | `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, and `thread/read` are delegated to Codex App Server. Native IDs must come from App Server responses/events; Workbench does not fabricate them. Local `RuntimeState`/active-turn fields are process controller state, not a persisted replacement for Native history. |
| `src/shared/thread-read-model.ts` | `NATIVE_ADAPTER_PASS` | Parses `thread/read` into a read-only convenience model, preserves `raw`, and deliberately does not invent Conversation/Transcript/Task semantics or placeholder IDs. |
| `src/shared/persistence-store.ts` prompt recovery | `NATIVE_ADAPTER_PASS` | Durable recovery stores bounded identity/correlation metadata (`promptSha256`, length/ref, Native IDs/status). Raw prompt text is process-local compatibility data and is normalized out before persistence. |
| `src/codex/app-server-host.ts` | `NATIVE_ADAPTER_PASS` | One ordinary Main App Server process/transport multiplexes per-Native-Thread handles. Host routing does not implement a second approval/tool/runtime engine. |
| `src/main/runtime-registry.ts` | `NATIVE_ADAPTER_PASS` | In-memory nativeThreadId -> live handle registry. It does not persist Thread truth or impose a competing execution/resource scheduler; Codex remains authoritative for protocol/runtime failures. |
| `src/main/native-provider-runtime-adapter.ts` | `NATIVE_ADAPTER_PASS` | Automation can dispatch only through an already-attached Native runtime. A missing target fails closed instead of creating/resuming another runtime. Observe is query-only; reconcile reads the same Native Turn and may refresh only Workbench projection. |
| `src/codex/automation/native-provider-port.ts` | `NATIVE_ADAPTER_PASS` | Provider request identity is the authoritative Native Turn ID. Unknown outcomes are observed/reconciled; the provider seam does not invent a second Turn or blind-resend one. |
| `src/codex/composer-capabilities.ts` | `NATIVE_ADAPTER_PASS` | Adapts App Server model capabilities and UI preferences into native turn options. Approval and sandbox values are protocol parameters, not a Workbench approval/sandbox executor. |
| `src/renderer/message-projection.ts` and Thread UI rendering | `WORKBENCH_INCREMENT_PASS` | Converts Native read/events into display cards only. Renderer local storage is used for UI/draft state, not a persisted Native transcript. |
| `src/codex/map-tool.ts`, `src/main/map-coordinator.ts`, `src/main/project-map-manager.ts` | `WORKBENCH_INCREMENT_PASS` | Map is an explicit Workbench projection capability. Maintenance work executes as real Codex Native Threads/Turns with bounded dynamic tools; MapStore owns Map projection, not Native execution truth. Maintenance/fallback Threads are explicitly scoped and excluded from ordinary user Thread identity. |
| `src/automation/state-machine.ts` | `WORKBENCH_INCREMENT_PASS` (outside Native runtime truth) | This is Workflow Truth for Automation stages/actions, not a replacement for Codex Thread/Turn/Agent execution. |

## Transcript / context conclusion

There is no durable Workbench copy of the Native transcript in the audited path.

- Historical turns/items are obtained from `thread/read` and projected on demand.
- `ThreadProjection` persists product/navigation metadata and bounded last-known runtime metadata, not turn/item bodies.
- Prompt recovery persists digest/length/correlation, not raw submitted prompt text.
- UI message projection is derived from Native read/events and is not a durable conversation database.

Existing regression evidence includes `tests/arch-v2-7-prompt-recovery.test.ts`, which asserts that raw prompt text is absent from the persistence file and remains unavailable after reopen.

## Agent / subagent / tool conclusion

The audited source tree contains no separate Workbench agent runner, subagent runtime, or generic Native tool executor/registry.

Native item types such as collaboration-agent tool calls are parsed as Native items. Workbench's dynamic Map tools are narrow product-side channels handled through Codex App Server server requests; they do not replace Codex's native tool runtime.

Automation's workflow state machine remains legitimate Workbench orchestration truth. It must not be confused with an LLM agent/subagent runtime merely because both involve states and transitions.

## App Server process topology

Ordinary user-facing Native Threads share the production `AppServerHost` transport. This was already established by `ARCH-V2-2` and its real multi-thread smoke evidence.

There are intentional Map exceptions:

- resumed Conversation Map compatibility fallback;
- Project Map maintenance/update;
- bounded Project Map context reader.

These paths can start isolated `AppServerProcessClient` instances or hidden/ephemeral Native maintenance Threads because the current CLI ABI does not allow registering `dynamicTools` on `thread/resume` and because Map uses a separate bounded capability domain.

This is **not** classified as duplicate Native execution truth: the maintenance work still runs as Codex-native Thread/Turn execution, is explicitly scoped, and writes only Map projection state. However, process reuse is an optimization opportunity. R7/R8 may evaluate sharing a compatible maintenance Host if the CLI capability boundary allows it, without changing Map ownership semantics.

See also:

- `docs/ARCH-V2-1-MAP-ACTIVATION-CONTRACT.md`
- `docs/ARCH-V2-2-RUNTIME-REALITY.md`
- `docs/ARCH-V2-2-SPAWN-TOPOLOGY.md`

## Regression evidence already present

The audit relied on existing tests/contracts rather than introducing a no-op implementation diff:

- `tests/arch-r2-shared-native-runtime.test.ts` — missing Native targets fail closed; reconcile does not redispatch `turn/start`; explicit reconcile refreshes only projection.
- `tests/arch-v2-7-prompt-recovery.test.ts` — raw prompt is never persisted.
- `tests/native-thread-runtime.test.ts` — Native runtime identity/turn/read/recovery behavior.
- `tests/app-server-host.test.ts` — shared Host routing and per-thread isolation.
- `tests/thread-read-model.test.ts` — read-only Native thread parsing.
- `tests/message-projection.test.ts` — renderer projection over Native values.
- `tests/composer-capabilities.test.ts` — capability/preference/native-option adaptation.
- Map coordinator/manager tests — explicit Map projection and compatibility maintenance behavior.

The full repository CI at the pre-audit integration checkpoint was already green after the `workbench/next` workflow transition. This R5 checkpoint changes documentation only.

## Exit decision

R5 exit condition is satisfied:

> Codex-facing Workbench code is native adapter/projection/product logic, not a competing Thread/context/agent/tool runtime.

No `DUPLICATE_RUNTIME_CHANGE` was proven. Therefore no R5 production feature branch should be created merely for appearance.

The next active stage is `R6 — Manual / Automation Decouple`.
