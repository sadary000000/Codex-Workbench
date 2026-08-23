# ARCH-V2-8 FIX ROUND 4 — Source Evidence Index

## Production compatibility path

| File | Evidence |
| --- | --- |
| `src/codex/app-server-protocol-contract.ts` | Verified binary/schema contract, InitializeResponse/Params provenance, provenance assertion |
| `src/codex/app-server-capabilities.ts` | ABI-native request/response validation, stable version boundary, capability parsing |
| `src/codex/app-server-bootstrap.ts` | Validate request, initialize, validate response, then notify initialized |
| `src/codex/app-server-client.ts` | Binary/schema/request attestation carried by client |
| `src/codex/app-server-host.ts` | Host-owned initialize and attestation propagation |
| `src/codex/native-thread-runtime.ts` | Skip-initialize guard requires verified Host attestation |

## Contract and regression tests

| File | Evidence |
| --- | --- |
| `tests/app-server-capabilities.test.ts` | ABI response/request/schema/version/extra-field contract cases |
| `tests/arch-v2-8-fix-round-4.test.ts` | Round 4 negative gate, provenance, production path source audit, no-side-effect contract |
| `tests/app-server-host.test.ts` | Host schema/binary/request attestation |
| `tests/fixtures/fake-app-server.mjs` | Four-field ABI-native fake server fixture |
| `tests/native-thread-runtime.test.ts` | Host-owned runtime and skip-initialize guard regression |

## Runtime evidence

- Real resolver initialize probe: documented in `ARCH-V2-8-FIX-ROUND-4-STAGE-REVIEW.md` and JSON evidence.
- Protocol generation: `npm run test:protocol:arch-v2-2`, 642 TypeScript files and 285 JSON schema files, repeatability PASS.
- Isolated build/package: `dist-stage-arch-v2-8-fix-round-4`, not the locked standard package directory.

## Review package contents

```text
ARCH-V2-8-FIX-ROUND-4-STAGE-REVIEW.md
ARCH-V2-8-FIX-ROUND-4-EVIDENCE.json
ARCH-V2-8-FIX-ROUND-4-TEST-SUMMARY.md
ARCH-V2-8-FIX-ROUND-4-PROVENANCE.txt
ARCH-V2-8-FIX-ROUND-4-SOURCE-EVIDENCE-INDEX.md
ARCH-V2-8-FIX-ROUND-4-GPT-REVIEW-PROMPT.md
ARCH-V2-8-FIX-ROUND-4-SUBAGENTS.md
PACKAGE-MANIFEST.txt
ARCHITECTURE-BASELINE-V2-FINAL.md
ARCH-V2-8-FINAL-FREEZE-MANIFEST.json
ARCH-V2-8-CAPABILITY-MATRIX.md
ARCH-V2-8-FROZEN-CONTRACT-CHECK.md
ARCH-V2-8-COMPATIBILITY-REGRESSION.md
ARCH-V2-8-DEFERRED-DEBT.md
```

The package deliberately excludes cookies, tokens, browser profiles, private chats, raw business prompts, production databases, and complete production journals.
