# ARCH-V2-5 Regression Evidence

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS, 329/329 |
| ARCH-V2-5 targeted | PASS, 7/7 |
| isolated `npm run build` | PASS |
| isolated Windows package | PASS |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| WEB-6.6 protocol real smoke | PASS, read-only, 0 prompts |
| V1 Frozen Core changed | NO |
| old donor changed | NO |
| real business prompt count | 0 |

隔离 package 位于 `dist-stage-arch-v2-5/package`；没有覆盖用户正在使用的标准
`dist/package`。
