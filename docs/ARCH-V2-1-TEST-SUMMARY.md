# ARCH-V2-1 Test Summary

## Automated

| Command | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm test` | PASS — 302/302 |
| targeted Native/Map/Project Map tests | PASS — 37/37 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |

## Real App Server

| Command | Result | Key evidence |
| --- | --- | --- |
| `npm run test:real:map` | PASS | one real Map tool call, revision 1, ephemeral cleanup |
| `npm run test:real:resumed-map` | PASS | resume has no dynamicTools, compatibility fallback call 1, same ID |
| `npm run test:real:project-map` | PASS | two member IDs, maintenance excluded, revision 2→3 after restart |

No user ChatGPT/WebGPT prompt was sent by these tests. The real smokes use isolated temporary directories and test-only bounded prompts; cleanup attempted deletion of all generated Native Threads.

## Static hygiene

- `git diff --check`: run at final gate.
- Secret scan: run at final gate against stage package inputs only.
- Old donor `D:\办公\AI\Codex_Workbench` was not modified.
- AUT-2/AUT-3, WebGPT, Policy and Shared CodexHost were not implemented or entered.

