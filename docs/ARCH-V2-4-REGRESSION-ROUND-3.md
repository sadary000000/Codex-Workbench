# ARCH-V2-4 Regression Matrix — FIX ROUND 3

| Area | Result | Evidence |
|---|---|---|
| Full Node test suite | PASS | `npm test` — 322/322 |
| Type/check gate | PASS | `npm run check` |
| Isolated build | PASS | `CODEX_WORKBENCH_DIST=dist-stage-arch-v2-4-round-3 npm run build` |
| Isolated Windows package | PASS | `node scripts/package-win.mjs` |
| Dependency audit | PASS | `npm audit --omit=dev` — 0 vulnerabilities |
| Diff whitespace | PASS | `git diff --check`; only CRLF warnings |
| WEB-6.4 Arbiter | PASS | isolated owned-process real smoke |
| WEB-6.6 protocol/status | PASS | isolated owned-process real smoke |
| Journal safety | PASS | before/after SHA identical |
| Real business prompts | PASS | 0 |
| V1 Frozen Core | PASS | no core file changed |

## Scope regressions

Round 3 did not activate Automation, Planner, Workflow, Requirement, ChatGPT project creation, real prompt sending, or a second conversation truth. The Arbiter and Control Plane behavior was tested through existing public CLI paths only.

## Standard package limitation

The standard `dist/package` remains locked by the user’s running Workbench. No unrelated process was force-killed. The isolated package is the package used for Round 3 real evidence.
