# ARCH-V2-1 Map ON Regression

## Real App Server smoke matrix

| Smoke | Result | Evidence |
| --- | --- | --- |
| New Native Thread + Map dynamic tool | PASS | real `item/tool/call` count 1; patch accepted; revision `0→1`; ephemeral cleanup |
| Resume existing Native Thread | PASS | same `nativeThreadId`; `dynamicTools` absent from resume; compatibility fallback call count 1; revision `0→1` |
| Project Map two-member update | PASS | two source Threads; one maintenance Thread; context request 1 次; revision `2→3` after manager restart |
| Pause/resume contract | covered by existing unit and real Map pause/resume script | paused Turn marks dirty; cursor does not advance until enabled |

## Live enable fix

The previous implementation only called `ConversationMapCoordinator.enable()`, leaving an already-loaded Runtime with the old Map OFF lifecycle. The current `enableConversationMap()` path:

1. validates the persisted Thread projection;
2. rejects an active Turn with `MAP_RUNTIME_BUSY`;
3. enables the sidecar;
4. closes and detaches the idle Runtime;
5. resumes the same Native Thread ID with `mapEnabled=true` and `mapToolEnabled=false`;
6. marks it for bounded compatibility maintenance;
7. attaches the candidate under the unchanged ID.

This does not claim that `thread/resume` can register a native tool. It makes the sidecar lifecycle effective without introducing a replacement Thread.

## Project Map OFF regression

`ProjectMapManager.maintenanceRead()` now checks the Project Map status before `ensureRuntime()`. An unavailable/disabled Project Map fails with `PROJECT_MAP_NOT_ENABLED`; no maintenance process is started.

## Known boundary

Only a new `thread/start` can expose the native Map dynamic tool in the current CLI ABI. Existing/resumed Native Threads use the bounded compatibility path. This is an explicit protocol limitation, not a hidden capability claim.

