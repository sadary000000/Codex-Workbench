# ARCH-V2-8 Compatibility Regression

## Baseline

- Repository: D:\办公\AI\Codex_Workbench_V1
- HEAD at audit start: 17f7c9bd096ec6aad94b8106af2a11157d25ec82
- ARCH-V2-7 implementation commit: a17d65e3be8e4ea5a7e16d11671dd055171849c0
- Old donor and D:\办公\AI\Auto_Agent: read-only, not modified.
- No real business Prompt or new business Chat.

## Automated regression

| Command / set | Result |
|---|---:|
| npm run check | PASS |
| npm test | PASS — 377/377 |
| ARCH-V2-7 targeted set | PASS — 30/30 |
| ARCH-V2-1~6 selected regression | PASS — 64/64 |
| Independent compatibility audit total | PASS — 584 assertions across grouped sets |
| npm run build | PASS |
| npm run package:win | PASS |
| npm audit --omit=dev | PASS — 0 vulnerabilities |
| git diff --check | PASS — existing LF/CRLF warnings only |
| scoped high-confidence secret scan | PASS — 0 credential-pattern hits |

## Real protocol evidence

| Probe | Result | Meaning |
|---|---|---|
| Direct App Server initialize | PASS | stdio process and response shape are observable |
| Actual userAgent vs allowlist | FAIL_WITH_EVIDENCE | 0.148.0-alpha.9 is outside verified 0.147.0 |
| Schema generation | PASS | current binary generated 361 JSON schema files |
| Packaged official CLI status | FAIL_WITH_EVIDENCE | bounded TIMEOUT after 15070 ms |
| Real thread/turn business flow | NOT_TESTED | prohibited by this stage safety scope |

## Regression interpretation

The source-level V2.1–V2.7 compatibility matrix remains green. That does not erase the installed-runtime version drift or the official CLI timeout. ARCH-V2-8 therefore remains READY_FOR_GPT_FINAL_REVIEW, not FINAL_FROZEN.
