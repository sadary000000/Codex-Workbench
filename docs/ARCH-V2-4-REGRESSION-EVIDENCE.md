# ARCH-V2-4 Regression Evidence — FIX ROUND 1

## Current runs

| Boundary | Result | Evidence |
|---|---|---|
| Native navigation/restart | PASS | `npm run test:real:navigation` |
| Native workspace interrupt/continue/restart | PASS | `npm run test:real:workspace` |
| Native multi-thread isolation | PASS | `npm run test:real:multi-thread` |
| Shared Codex Host recovery | PASS (existing evidence) | `npm run test:real:shared-host-recovery` |
| ARCH-V2-2 generated protocol repeatability | PASS | `npm run test:protocol:arch-v2-2`, repeatable TS/JSON hashes |
| Conversation Map runtime | PASS | `npm run test:real:map` |
| Project Map isolation/restart | PASS | `npm run test:real:project-map` |
| WebGPT Control Plane protocol | PASS | `npm run test:real:webgpt:protocol`, `newRealPrompts=0` |
| WebGPT arbiter/control smoke | PASS_WITH_EVIDENCE | `dist/review/WEBGPT-WEB6.4-REAL-GATE.json`, second safe run |

## ARCH-V2-4 targeted and full tests

```text
npm run check                 PASS
npm test                      317 pass / 0 fail
FIX ROUND 1 targeted          PASS (FIX-01/03/04/05/06/07 tests)
npm audit --omit=dev          PASS / 0 vulnerabilities
scoped secret scan            PASS
git diff --check              PASS
```

## Real control evidence

The first run exposed a stale assertion (`USER_CONTROL` was normalized from the internal legacy name) and observed the pre-existing Journal SHA transition `E116...E77B0 → 7D2F...661CE`; no rollback was attempted. After the mechanical assertion correction, the second safe run passed with `E3A6...EA6B → E3A6...EA6B`, 0 real prompts, no credentials, and no private page content. The exact historical byte delta is not recoverable from available evidence.

## Scope boundary

No AUT-2/AUT-3 prompt, ChatGPT new Chat, Cookie/Token read, full Journal export, V1 Frozen Core change, Map redesign, or Shared Host redesign was performed in this round.
