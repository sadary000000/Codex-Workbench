# ARCH-V2-6 Test Summary

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS, 340/340 |
| targeted ARCH-V2-6 + ARCH-V2-4 tests | PASS, 14/14 |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| secret scan | PASS |
| isolated `npm run build` | PASS |
| isolated `npm run package:win` | PASS |
| standard `npm run build` | EPERM because running packaged EXE locks `dist/package` |

No real business prompt was sent.
