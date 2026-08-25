# STAGE-K0 Test Contract and Results

Date: `2026-08-25`

## Required commands

| command | result | evidence |
|---|---|---|
| `npm run check` | PASS | TypeScript production and test projects both passed |
| `npm test` | PASS | `439/439` |
| `npm audit --omit=dev` | PASS | `0 vulnerabilities` |
| `git diff --check` | PASS | no whitespace errors; CRLF normalization warnings only |
| `npm run build` | PASS | `CONTROL PLANE SCHEMA PASS`, `BUILD PASS` |
| `npm run package:win` | PASS | GUI and CLI EXEs produced |
| secret scan | PASS | no credential-pattern matches in scoped K0 inputs |

## Targeted coverage already exercised

- explicit RequirementOrigin and same-project origin validation;
- immutable Requirement payload/hash and immediate predecessor chain;
- duplicate version/root and orphan-origin rejection;
- v0/v1/v2/v3 → v4 compatibility;
- full migration document equivalence and interrupted migration recovery;
- SQLite transaction rollback and JSON backup restoration;
- policy pin/scope and ActionIntent/ActionAttempt correlation;
- accepted-provider request reattachment by idempotency reference;
- observation correlation and reconcile-only unknown outcomes;
- generic reconcile fail-closed boundary;
- AUT-R0 Requirement provider regression.

The final targeted K0 run was `51/51 PASS`; the final full suite was
`439/439 PASS`.

## Real operations

```text
real business prompts: 0
new business chats: 0
```

K0 is a foundation stage. No real Prompt is required or permitted by the
stage scope. Existing contract, unit, persistence, and provider-boundary
evidence is sufficient for this gate.

## Build provenance

```yaml
implementation_commit: ece5363
gui_package: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
gui_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_package: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
cli_sha256: 5479FA1CCC75AAF32C6431D573F9EFB4A99255A355EA3A815F995ABD191DC9F4
test_timestamp: 2026-08-25T17:35:14+08:00
```

## Final gate record

The final report must include exact exit codes, test counts, build/package
paths, package hash, and secret-scan scope. A green unit suite alone cannot be
reported as the K0 Gate.
