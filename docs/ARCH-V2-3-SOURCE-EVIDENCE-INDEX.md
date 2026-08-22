# ARCH-V2-3 Source Evidence Index

## Stage sources

| Source | Use |
|---|---|
| `docs/ARCH-V2-0-ARCHITECTURE-BASELINE-DRAFT.md` | Query/Command/Reconcile and truth ownership baseline |
| `docs/ARCH-V2-2-GPT-REVIEW.md` | ARCH-V2-2 PASS and the sole next-stage instruction |
| `docs/ARCH-V2-3-IMPLEMENTATION-REALITY.md` | Scope and implementation reality |
| `docs/ARCH-V2-3-QUERY-SURFACE-INVENTORY.md` | Surface-by-surface inventory |
| `docs/ARCH-V2-3-QUERY-COMMAND-RECONCILE-CONTRACT.md` | Contract and side-effect boundary |

## Code/test sources

| Source | Evidence |
|---|---|
| `src/codex/native-thread-runtime.ts` | Native query-only read and explicit projection refresh |
| `src/main/main.ts` | IPC read purity and explicit WebGPT reconcile dispatch |
| `src/features/webgpt/runtime/webgpt-request-manager.ts` | Default pure request status |
| `src/main/webgpt-command.ts` | CLI status/reconcile parser |
| `src/main/webgpt-control.ts` | Control Plane validation/allowlist |
| `src/automation/store.ts` | Pure read vs explicit migration/writer boundary |
| `src/automation/sqlite-persistence.ts` | Query-only SQLite inspection and migration recovery boundary |
| `tests/native-thread-runtime.test.ts` | Native query purity/fail-closed tests |
| `tests/webgpt-request-manager.test.ts` | Explicit reconcile negative/positive fixture |
| `tests/automation-persistence.test.ts` | Hash/lock/needs-migration evidence |

## Evidence rule

No cookie, token, browser profile, private ChatGPT content or real WebGPT Prompt is included in this stage package.
