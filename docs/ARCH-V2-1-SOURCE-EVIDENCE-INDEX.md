# ARCH-V2-1 Source Evidence Index

| Area | Source |
| --- | --- |
| Native start/resume capability | `src/codex/native-thread-runtime.ts` — `startInternal`, `thread/start`, `thread/resume`, `dynamicToolsRegistered` |
| Map tool contract | `src/codex/map-tool.ts` — `MAP_DYNAMIC_TOOL_SPEC`, `MAP_THREAD_START_HINT` |
| Runtime creation and activation | `src/main/main.ts` — `RuntimeTarget`, `createRuntime`, `loadRuntimeForThread`, `enableConversationMap` |
| Sidecar activation decision | `src/main/map-activation.ts` — `isConversationMapSidecarEnabled` |
| Conversation Map persistence/fallback | `src/main/map-coordinator.ts` — `enable`, `markTurnCompleted`, compatibility fallback |
| Project Map isolation | `src/main/project-map-manager.ts` — `maintenanceRead`, `ensureRuntime`, `updateFromDelta` |
| Runtime identity isolation | `src/main/runtime-registry.ts` |
| Map OFF tests | `tests/native-thread-runtime.test.ts`, `tests/map-activation.test.ts` |
| Project Map OFF safety test | `tests/project-map-manager.test.ts` |
| Real new Map tool smoke | `scripts/real-map-smoke.ts` |
| Real resumed fallback smoke | `scripts/real-resumed-map-smoke.ts` |
| Real Project Map smoke | `scripts/real-project-map-smoke.ts` |
| Historical CLI protocol evidence | `docs/PHASE-06-MAP-RUNTIME-CAPABILITY-AUDIT.md` |
| ARCH-V2-0 accepted baseline | `docs/ARCH-V2-0-ARCHITECTURE-BASELINE-DRAFT.md`, `docs/ARCH-V2-0-GPT-REVIEW.md` |

