# ARCH-V2-6 FIX ROUND 1 — Test Summary

Implementation commits: `b8591db`, `6de4b5f`, `a034737`, `0d362b7`, `9a49338`
Real business Prompt: **NO**
Gate subagents: **A/B/C/D/E naturally completed and archived; running=0**

| suite | result |
|---|---:|
| `npm run check` | PASS |
| `npm test` | 347/347 PASS |
| ARCH-V2-6 provider boundary + evidence correlation | 11/11 PASS |
| ARCH-V2-3/4/5 regression | 27/27 PASS |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| changed source/test secret scan | PASS |
| `git diff --check` | PASS |
| isolated `npm run package:win` | PASS |

## ARCH-V2-6 fixture coverage

- static URL-shaped provider field leak and seam classification;
- paused compatibility submit/reconcile fail closed;
- capability denial before provider submit;
- missing policy pin before provider submit;
- explicit DENY before provider submit;
- missing runtime capability before provider submit;
- valid pinned policy + complete effective policy + READY runtime capability reaches only the isolated fixture;
- policy authority uses `PROMPT` for submit and `VERIFY` for reconcile without treating verification as retry;
- production composition root validates the persisted ActionIntent/ActionAttempt correlation before provider side effects;
- evidence correlation remains bounded, opaque, immutable and queryable.

## Real-world restrictions

No real App Server smoke and no real business Prompt were executed. This is intentional for ARCH-V2-6 FIX ROUND 1 and is recorded as the non-blocking P2-01 limitation.

The standard package was not overwritten because running EXE processes hold `dist/package/d3dcompiler_47.dll`. An isolated package was built at:

`D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-6-fix-round-1d\package\`
