# ARCH-V2-2 Stage Review

## Scope Resolution

```yaml
stage_name: ARCH-V2-2 Shared CodexHost / Generated Protocol / Runtime Dedup
base_commit: 55a2aec
implementation_commit: 283f5d9
goal: one initialized App Server host for ordinary Main Native Threads, generated protocol/version evidence, and explicit spawn topology
in_scope:
  - ordinary Main Native Thread shared Host/ThreadHandle transport
  - initialize/request/notification/server-request routing
  - host crash/restart and same nativeThreadId resume/read
  - stable Codex protocol generation/verification
  - spawn topology audit and ARCH-V2-1 regression
out_of_scope:
  - WebGPT
  - Automation/AUT gates
  - Map redesign
  - Renderer rewrite
  - Project Map capability migration
  - Conversation/Transcript/Task truth
```

## Implementation

- Added `AppServerHost` and `AppServerThreadClient`.
- Added `skipInitialize` injection for a client that is already attached to a Host handshake.
- Wired ordinary Main `createRuntime()` to the shared Host; shutdown closes Host after Thread runtimes.
- Added stable protocol contract facts and repeatable generation verification.
- Reworked the real multi-thread smoke to prove one Host PID across two cwd values.
- Added real Host crash/restart smoke with original Native IDs.

## Gate status

```yaml
shared_host: PASS
generated_protocol: PASS
runtime_dedup: PASS_FOR_ORDINARY_MAIN_NATIVE_THREADS
multi_thread_isolation: PASS
crash_restart_same_identity: PASS
approval_routing: PASS_UNIT_CONTRACT
map_regression: PASS
v1_core_changed: NO
automated_gate: PASS
real_appserver_gate: PASS
```

## Package provenance

```yaml
package: D:/办公/AI/Codex_Workbench_V1/dist/package/Codex Workbench V1.exe
outer_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
main_js_sha256: E157B091DEA75083828A07E8751F387AB0AF26F6AEBF4717ADBD4F841390FF36
renderer_js_sha256: 400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```

## Subagents

Five requested parallel audits completed naturally and were closed after review. A and C were adopted for the target V1 source reality/spawn topology. B, D and E executed against the old donor worktree context and were not adopted as V1 evidence; their findings were retained only as rejected-context notes. `running_subagents_at_gate: 0`.

## User-file and legacy protection

- `V1docs.zip`, `dist-stage-a/`, `指导文档/*.docx` were not staged or modified.
- `D:/办公/AI/Codex_Workbench` donor was not modified.
- `D:/办公/AI/Auto_Agent` was not modified.
- No WebGPT, Automation, AUT gate, Renderer or Native truth redesign was included.

## Review boundary

No replacement Thread, no local Native history reconstruction, no WebGPT/Automation changes, and no modification to the old donor project.
