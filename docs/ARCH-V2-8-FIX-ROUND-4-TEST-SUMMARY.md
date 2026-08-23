# ARCH-V2-8 FIX ROUND 4 — Test Summary

## Automated verification

| Test | Result | Notes |
| --- | --- | --- |
| `npm run check` | PASS | TypeScript/check gate completed |
| `npm test` | PASS | 400/400 |
| Round 4 capability/host/runtime targeted tests | PASS | 11/11 |
| `npm run test:protocol:arch-v2-2` | PASS | Generated TypeScript 642; JSON schema 285; repeatable |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities |
| `git diff --check` | PASS | Normal line-ending warnings only |
| Scoped secret scan | PASS | No high-confidence secret patterns |
| Isolated `npm run build` | PASS | `dist-stage-arch-v2-8-fix-round-4` |
| Isolated `npm run package:win` | PASS | Same isolated output root |

The standard package directory was not overwritten because the known running EXE lock was preserved. No unrelated process was terminated.

## Round 4 contract cases

- verified four-field `InitializeResponse` accepted without response `protocolVersion` or response `capabilities`;
- each of the four required response fields is required;
- request must contain `clientInfo` and explicit boolean `capabilities.experimentalApi`;
- request capability must match the requested mode;
- schema provenance mismatch fails with `APP_SERVER_SCHEMA_PROVENANCE_MISMATCH`;
- unresolved or mismatched binary provenance fails before process use;
- prerelease/future version boundary does not pass stable `0.147.0` validation;
- extra legacy response fields do not become required ABI fields;
- Native/Host/Map/Project Map paths are source-audited to shared bootstrap;
- negative gate produces no initialized business runtime, Thread, Turn, or Prompt.

## Real initialize probe

The actual resolver and bootstrap path completed initialize with exit code 0. The observed response keys were exactly the four verified ABI fields. A `remoteControl/status/changed` notification was observed. No business method was called and no business Prompt or Chat was created.

## Regression boundary

Round 3's P1 caused by nonexistent response-field requirements is closed. Operation capability registry, unsupported-operation fail-closed behavior, binary provenance, schema provenance, and Native identity boundaries remain covered.

## Final artifact reconciliation

The final baseline, manifest, capability matrix, frozen contract check, compatibility regression, deferred debt, stage review, and test summary all agree on:

```yaml
implementation_commit: fe30b94e090ea2bfd2b2ef78b700bf81d72e5db3
P0: 0
P1: 0
P2: 3
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
finalFrozen: false
AUT-2/AUT-3: PAUSED
real_business_prompts: 0
new_business_chats: 0
```

The exact final-manifest and review-package digests are recorded in their adjacent sidecars after artifact creation to avoid a circular package hash.
