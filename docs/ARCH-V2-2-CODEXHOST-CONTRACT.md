# ARCH-V2-2 Shared CodexHost Contract

## Host ownership

`AppServerHost` owns exactly one App Server process/stdio transport per host instance, one `initialize` handshake, global JSON-RPC request correlation, connection health, process exit/restart and final shutdown.

## ThreadHandle ownership

`AppServerThreadClient` is the lightweight ThreadHandle adapter. It owns:

- one `nativeThreadId` binding;
- per-thread listener and notification waiter sets;
- per-thread server-request callback;
- Thread-scoped messages/snapshot view.

It does not own a process, initialize handshake, Native transcript, Tool lifecycle, Subagent lifecycle, or Workbench Conversation truth.

## Lifecycle contract

```text
AppServerHost.start()
  -> spawn once
  -> initialize once
  -> initialized notification

ThreadHandle.start()
  -> host.start()

ThreadHandle.close()
  -> detach handle only
  -> never kill shared host

AppServerHost.close()
  -> close transport once
  -> application shutdown only
```

## Identity and routing invariants

- `thread/start` response binds the returned nativeThreadId.
- `thread/resume` binds the requested nativeThreadId before sending the request.
- A notification with an explicit different thread identity is not delivered to another handle.
- A server request without an unambiguous owner is rejected by the underlying App Server client.
- Shared Host core methods are checked against `src/codex/app-server-protocol-contract.ts`.
- Native Thread identity is never replaced by a Workbench handle ID.

## Crash/restart

Host process exit notifies all attached handles and leaves their native identities intact. Restart creates a new transport and initialize handshake; explicit Runtime `resume/read` uses the same nativeThreadId. No fake completion, local history reconstruction, or replacement Thread is created.
