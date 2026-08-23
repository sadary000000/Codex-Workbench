# ARCH-V2-4 Source Evidence Index — FIX ROUND 3

## Product change

- `src/features/webgpt/runtime/webgpt-workspace.ts` — bounded status fallback while the Browser view is closed, destroyed, not ready or loading; normal page probing remains after readiness.

## Smoke harness changes

- `scripts/real-webgpt-web6.4-arbiter-smoke.ts` — isolated user-data, owned descriptor/process checks, control/lease sequence, zero-prompt evidence.
- `scripts/real-webgpt-web6.6-protocol-smoke.ts` — isolated user-data, owned host startup, status readiness evidence, protocol mismatch/capability fixtures.

## Evidence

- `ARCH-V2-4-WEB6-4-ARBITER-REAL-SMOKE.md` and sanitized `WEBGPT-WEB6.4-REAL-GATE.json`.
- `ARCH-V2-4-WEB6-6-STATUS-SMOKE.md` and sanitized `WEBGPT-WEB6.6-REAL-GATE.json`.
- `ARCH-V2-4-JOURNAL-SAFETY-EVIDENCE.md`.

## Safety and provenance

The package excludes cookies, tokens, passwords, browser profiles, private chat content, prompt/response bodies and the full production Journal. The standard package lock and old donor status are explicitly disclosed.
