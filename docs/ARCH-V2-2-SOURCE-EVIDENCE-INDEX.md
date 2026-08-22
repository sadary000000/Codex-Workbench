# ARCH-V2-2 Source Evidence Index

## Production source

- `src/codex/app-server-host.ts` — Shared Host and ThreadHandle transport adapter.
- `src/codex/app-server-client.ts` — unchanged low-level JSON-RPC process transport owner.
- `src/codex/native-thread-runtime.ts` — optional pre-initialized client injection; Native Thread/Turn/recovery authority remains here.
- `src/codex/app-server-protocol-contract.ts` — tested version, generation hashes and core method allowlist.
- `src/main/main.ts` — ordinary Main Runtime composition and Host shutdown wiring.
- `src/main/runtime-registry.ts` — Native Thread runtime registry, still keyed by nativeThreadId.

## Tests/scripts

- `tests/app-server-host.test.ts`
- `scripts/real-multi-thread-runtime-smoke.ts`
- `scripts/real-shared-host-recovery-smoke.ts`
- `scripts/verify-arch-v2-2-protocol.mjs`

## Prior regression evidence

- `docs/ARCH-V2-1-*`
- `docs/ARCH-V2-1-MAP-ON-REGRESSION.md`
- `docs/ARCH-V2-1-REALITY.md`
