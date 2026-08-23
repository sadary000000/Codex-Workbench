# ARCH-V2-8 Test Summary

## Automated Gate

| Check | Result |
|---|---|
| npm run check | PASS |
| npm test | PASS — 377/377 |
| ARCH-V2-7 targeted | PASS — 30/30 |
| ARCH-V2-1~6 selected regression | PASS — 64/64 |
| Independent grouped compatibility audit | PASS — 584 assertions reported |
| npm run build | PASS |
| npm run package:win | PASS |
| npm audit --omit=dev | PASS — 0 vulnerabilities |
| git diff --check | PASS; existing LF/CRLF warnings only |
| scoped secret scan | PASS; no high-confidence credential-pattern hits |

## Real protocol

- Direct App Server initialize: PASS.
- JSON Schema generation: PASS; experimental output 361 files, stable contract output 642 TS / 285 JSON schema files as recorded by prior baseline.
- Resolver-selected binary and generated stable contract: PASS.
- Observed Desktop runtime userAgent differs from Workbench verified allowlist: FAIL_WITH_EVIDENCE.
- Packaged official CLI webgpt.status: bounded TIMEOUT, FAIL_WITH_EVIDENCE.
- Real business Thread/Turn/Prompt: NOT_TESTED by explicit ARCH-V2-8 safety scope.

## Interpretation

Source-level compatibility remains green, but the runtime version drift and the independent B/D challenge findings prevent this document from claiming a final freeze. The correct local gate is READY_FOR_GPT_FINAL_REVIEW.
