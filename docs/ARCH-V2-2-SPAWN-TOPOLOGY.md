# ARCH-V2-2 Spawn Topology

## Production Main path

```text
Workbench Main
  -> one AppServerHost
       -> one AppServerProcessClient
            -> codex app-server --stdio
       -> AppServerThreadClient A -> NativeThreadRuntime A
       -> AppServerThreadClient B -> NativeThreadRuntime B
```

The real multi-thread smoke observed one PID for A/B. Host creation is lazy and shared by ordinary Main Native Threads.

## Explicit independent paths

The following remain intentionally isolated and are not hidden ordinary Thread spawns:

1. Conversation Map compatibility fallback: requires a dynamic-tool capability on a temporary maintenance Thread after resume.
2. Project Map maintenance/update and bounded context reader: separate maintenance/read capability domains.
3. Real smoke cleanup clients, unit-test fakes, and standalone scripts: test infrastructure.
4. WebGPT Electron/browser processes: separate WebGPT domain, out of ARCH-V2-2.

Each exception has a named owner and test/doc path. No new per-thread `AppServerProcessClient` is created by `src/main/main.ts` for ordinary Native Thread runtime creation.

## Static audit

`new AppServerProcessClient` remains visible only in the base transport, Map/Project Map maintenance, cleanup/test/real smoke paths. The Main ordinary `createRuntime` path injects `AppServerHost.createThreadClient`.
