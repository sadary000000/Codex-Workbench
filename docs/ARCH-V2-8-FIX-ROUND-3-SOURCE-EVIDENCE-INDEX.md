# ARCH-V2-8 FIX ROUND 3 Source Evidence Index

## Strict App Server gate

- `src/codex/app-server-bootstrap.ts` — single production bootstrap boundary.
- `src/codex/app-server-capabilities.ts` — exact protocolVersion and requested experimentalApi validation.
- `src/codex/app-server-client.ts` — initialization attestation port.
- `src/codex/app-server-host.ts` — shared Host provenance/attestation and lifecycle.
- `src/codex/native-thread-runtime.ts` — no production `skipInitialize` bypass without attestation.
- `src/main/map-coordinator.ts` — shared bootstrap for Map compatibility path.
- `src/main/project-map-manager.ts` — shared bootstrap for Project Map read/maintenance paths.

## Control Plane capability gate

- `src/shared/webgpt-control-plane-contract.ts` — single capability registry and resolver.
- `src/main/webgpt-control.ts` — modern and legacy command authorization before handler dispatch.

## Recovery Provider Port / Bridge

- `src/main/main.ts` — production composition of Provider Port and External Action Bridge over the same RequestManager.
- `src/features/webgpt/automation/webgpt-provider-port.ts` — classifier-first recover/observe/reconcile path.
- `src/automation/webgpt-external-action.ts` — ActionAttempt/ProviderRequest correlation and no-resend recovery bridge.
- `tests/arch-v2-7-review-harness.test.ts` — isolated production-shaped provider recovery harness.
- `tests/arch-v2-6-provider-boundary.test.ts` — provider Port recovery and correlation contract.

## Migration identity

- `src/automation/migration-identity.ts` — all 23 collection identity fields, full index, missing/duplicate/drift rejection.
- `src/automation/migration-contract.ts` — migration service calls identity assertion.
- `src/automation/sqlite-persistence.ts` — candidate/source comparison and post-write identity assertion.
- `tests/arch-v2-8-fix-round-3.test.ts` — full identity and production call-site contract coverage.

## Evidence and package

- `docs/ARCH-V2-8-FIX-ROUND-3-EVIDENCE.json`
- `docs/ARCH-V2-8-FIX-ROUND-3-TEST-SUMMARY.md`
- `docs/ARCH-V2-8-FIX-ROUND-3-PROVENANCE.txt`
- `docs/ARCH-V2-8-FIX-ROUND-3-SUBAGENTS.md`
- `docs/ARCH-V2-8-FIX-ROUND-3-STAGE-REVIEW.md`
- `docs/ARCH-V2-8-FIX-ROUND-3-GPT-REVIEW-PROMPT.md`
