# ARCH-V2-3 Test Summary

## Automated

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS, 308/308 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| `git diff --check` | PASS; only normal LF/CRLF conversion warnings |

Secret scan: PASS; no credential-shaped matches in the ARCH-V2-3 source/tests/docs scope.

Package outputs:

```yaml
workbench_exe: D:/办公/AI/Codex_Workbench_V1/dist/package/Codex Workbench V1.exe
workbench_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_exe_sha256: 458721CF06D22BB9AB55C646C86EFCAC72ADB500880B89735AC8D1113D792013
control_plane_schema_sha256: 0E13F0B1D6A1A9AF37DFEEE13FEFEBE70F532BB5C6F75C29AD7860C2B7A72E59
```

## Real / high-fidelity regression

| Command | Result | Boundary |
|---|---|---|
| `npm run test:real:navigation` | PASS | Native Project/Standalone navigation and restart |
| `npm run test:real:workspace` | PASS | Native interrupt/continue/restart, same Thread ID |
| `npm run test:real:multi-thread` | PASS | Two Native Threads share host without event mixing |
| `npm run test:real:shared-host-recovery` | PASS | Shared Host restart, same IDs, no replacement |
| `npm run test:protocol:arch-v2-2` | PASS | Generated TS/JSON schema reproducible |
| `npm run test:real:map` | PASS | Map dynamic tool regression |
| `npm run test:real:project-map` | PASS | Project Map maintenance isolation/restart |
| `npm run test:real:webgpt:protocol` | PASS, `newRealPrompts: 0` | Packaged Control Plane status/initialize only |

No real WebGPT Prompt was sent. WebGPT query/reconcile semantics are covered by high-fidelity isolated fixtures; real Browser Prompt behavior is outside this stage's safe evidence boundary.

## High-fidelity boundary

Native query purity, WebGPT status/reconcile separation, and SQLite read-only inspection use isolated fakes/temporary files. No real WebGPT Prompt is sent. Existing real Native/App Server regressions are executed separately and are not replaced by unit tests.
