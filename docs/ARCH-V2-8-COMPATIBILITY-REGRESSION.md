# ARCH-V2-8 Compatibility Regression

## Historical blocker closure

Round 3 recorded two P1 findings because the local strict validator required `protocolVersion` and response `capabilities` that are absent from the verified Codex 0.147.0 `InitializeResponse`. GPT review identified these as one local ABI assumption error. Round 4 marks that historical failure `HISTORICAL_RESOLVED`.

## Current compatibility gate

```yaml
initialize_request:
  clientInfo: PASS
  capabilities.experimentalApi: PASS
initialize_response:
  codexHome: PASS
  platformFamily: PASS
  platformOs: PASS
  userAgent: PASS
  protocolVersion_required: false
  response_capabilities_required: false
binary_provenance: PASS
schema_provenance: PASS
server_identity_attestation: PASS
operation_capability_registry: PASS
negative_side_effect_gate: PASS
```

## Regression commands

```text
npm run check                         PASS
npm test                              400/400 PASS
Round 4 targeted contract regression  11/11 PASS
npm run test:protocol:arch-v2-2       PASS (TS 642 / JSON schema 285)
npm audit --omit=dev                  PASS (0 vulnerabilities)
isolated build                        PASS
isolated package                      PASS
real initialize probe                 PASS; no business side effect
```

## Final gate state

```yaml
P0: 0
P1: 0
P2: 3
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
finalFrozen: false
```
