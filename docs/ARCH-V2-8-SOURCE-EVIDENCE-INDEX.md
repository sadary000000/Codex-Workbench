# ARCH-V2-8 Source Evidence Index — Reconciled

```yaml
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
technicalGate: FAIL_WITH_EVIDENCE
finalFrozen: false
P0: 0
P1: 5
P2: 3
```

| Topic | Evidence |
|---|---|
| Reality and installed runtime | `docs/ARCH-V2-8-REALITY.md` |
| Capability classification | `docs/ARCH-V2-8-CAPABILITY-MATRIX.md` |
| Frozen truth/contract boundary | `docs/ARCH-V2-8-FROZEN-CONTRACT-CHECK.md` |
| Compatibility regression | `docs/ARCH-V2-8-COMPATIBILITY-REGRESSION.md` |
| Deferred P2 debt | `docs/ARCH-V2-8-DEFERRED-DEBT.md` |
| Architecture baseline candidate | `docs/ARCHITECTURE-BASELINE-V2-FINAL.md` |
| Machine-readable final manifest | `docs/ARCH-V2-8-FINAL-FREEZE-MANIFEST.json` |
| Review package inventory | `docs/ARCH-V2-8-REVIEW-PACKAGE-CONTENTS.txt` |
| Test summary | `docs/ARCH-V2-8-TEST-SUMMARY.md` |
| Subagent evidence | `docs/ARCH-V2-8-SUBAGENT-SUMMARIES.md` |
| Round 1 implementation evidence | `docs/ARCH-V2-8-FIX-ROUND-1-STAGE-REVIEW.md` and `docs/ARCH-V2-8-FIX-ROUND-1-EVIDENCE.json` |
| App Server client/provenance | `src/codex/app-server-client.ts`, `src/codex/app-server-host.ts`, `src/codex/codex-command.ts` |
| Capability validation | `src/codex/app-server-capabilities.ts`, `src/shared/webgpt-control-plane-contract.ts` |
| Native runtime boundary | `src/codex/native-thread-runtime.ts` |
| Recovery/identity boundary | `src/automation/stable-identity.ts`, `src/features/webgpt/automation/webgpt-provider-port.ts` |
| Migration fallback | `src/automation/sqlite-persistence.ts` |
| Current P1 findings | `docs/ARCH-V2-8-REALITY.md`, `docs/ARCH-V2-8-STAGE-REVIEW.md`, `docs/ARCH-V2-8-FINAL-FREEZE-MANIFEST.json` |

No final review artifact contains Cookie, Token, browser profile, password, private ChatGPT content or raw business Prompt.
