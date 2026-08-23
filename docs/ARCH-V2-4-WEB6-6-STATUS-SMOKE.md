# WEB-6.6 Status / Protocol Real Smoke — ARCH-V2-4 FIX ROUND 3

## Execution boundary

```yaml
package: D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-4-round-3\package\Codex Workbench V1.exe
user_data: unique OS temporary directory per run
newRealPrompts: 0
```

The smoke starts an owned isolated packaged Workbench and waits for the Control Plane descriptor before invoking the CLI. It does not use the standard locked package or an existing user session.

## Observed result

```yaml
status: PASS
status_elapsed_ms: 177
status_ok: true
protocolVersion: '1.0'
workbench: READY
webgpt: UNAVAILABLE
timeout: false
descriptorReady: true
ownedWorkbenchExit: null during smoke
version_mismatch_fixture: VERSION_MISMATCH
unsupported_capability_fixture: CAPABILITY_NOT_SUPPORTED
newRealPrompts: 0
```

`webgpt=UNAVAILABLE` is the honest state of a fresh unauthenticated isolated browser; it is not converted to READY. The important Round 3 condition is that status returns a bounded machine-readable result instead of waiting for a page probe until the outer Control Plane timeout.

## Safety

The descriptor was used only in memory for the local test connection. The authentication value was never written into evidence. No cookies, tokens, private page content or prompt bodies were read or included.
