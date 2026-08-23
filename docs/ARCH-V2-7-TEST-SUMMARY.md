# ARCH-V2-7 Test Summary

## Local results at evidence assembly

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 377/377 |
| ARCH-V2-7 targeted set | PASS — 30/30 |
| ARCH-V2-1~6 selected regression | PASS — 64/64 |
| `npm run build` | standard `dist` blocked by active EXE lock (`EPERM d3dcompiler_47.dll`); isolated build PASS |
| `npm run package:win` | isolated `dist-arch-v2-7` PASS |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS — only existing LF/CRLF warnings |
| scoped high-confidence secret scan | PASS — 0 credential-pattern hits |

Targeted set: migration contract 3, composition 2, PromptRecovery 1, read purity 1, Recovery Intent 10, Review Harness 13.

Selected regression command:

```text
node --experimental-strip-types --test tests/automation-foundation.test.ts tests/automation-persistence.test.ts tests/arch-v2-4-fix-round-1.test.ts tests/arch-v2-4-external-action.test.ts tests/arch-v2-5-policy.test.ts tests/arch-v2-5-production-consumers.test.ts tests/arch-v2-6-provider-boundary.test.ts tests/arch-v2-6-evidence-correlation.test.ts
```

Result: 64/64 PASS.

No real business Prompt or new business Chat was sent.

## Isolated package provenance

```text
dist-arch-v2-7/package/Codex Workbench V1.exe
outer_sha256=31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
resources/app/dist/main/main.js=EFC89E08CBBF973B8DCF59D594174515A2F2BA07AD69833FFE103345C869DA84
resources/app/dist/renderer/renderer.js=400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB
resources/app/package.json=1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```

The standard package was not overwritten because its Electron shell was in use. No unrelated process was terminated.
