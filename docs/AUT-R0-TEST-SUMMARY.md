# AUT-R0 Test Summary

Generated: 2026-08-24

| Gate | Command | Result |
|---|---|---|
| Type/check | `npm run check` | PASS |
| Targeted AUT-R0 | `node --experimental-strip-types --test tests/aut-r0-requirement-provider.test.ts tests/webgpt-command.test.ts tests/webgpt-control-contract.test.ts` | 25/25 PASS |
| Full regression | `npm test` | 414/414 PASS |
| Build | `npm run build` | PASS |
| Windows package | `npm run package:win` | PASS |
| Dependency audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Diff whitespace | `git diff --check` | PASS |
| Existing Control Plane real protocol smoke | `npm run test:real:webgpt:protocol` | PASS; 0 new real prompts |
| Live AUT-R0 Requirement provider smoke | not run | NOT RUN; no live provider fixture attached |

The NOT RUN entry is a limitation, not a fabricated PASS. The package keeps
the production entry contract and all contract/regression evidence so GPT can
decide whether a live smoke is required before acceptance.
