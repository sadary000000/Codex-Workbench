# Direct Codex vs Workbench Native A/B Result

- Run ID: native-ab-20260829T133257Z-ea3c0e
- Test ID: direct-codex-vs-workbench-native-ab-v1
- Exact tested commit: ea3c0ead934bacd90e17c40a0bcafef7eb6e1e86
- Control-plane commit: 649dab3f4ab9ff7fb384ac86a87fb4c56519dc2c
- Protocol source commit: ea3c0ead934bacd90e17c40a0bcafef7eb6e1e86
- Codex binary SHA-256: 935a1911ed2556e4ffcec995f4886ac2ac425863ba26fed264df62e30272ad9d
- Pinned model/effort: gpt-5.6-sol / medium

## Required-case results

| Case | Direct success | Workbench success | Median delta (ms) | Median ratio | Verdict |
|---|---:|---:|---:|---:|---|
| AB-READ-001-exact-reply | 4/4 | 4/4 | -242.58 | 0.9594 | PASS |
| AB-READ-002-package-contract | 4/4 | 4/4 | 1911.84 | 1.1893 | PASS |
| AB-READ-003-native-ownership | 0/8 | 0/8 | -4251.52 | 0.8251 | FAIL |

`AB-READ-003-native-ownership` had the one required variance escalation because the first Workbench CV was 0.230586 (> 0.20). The added eight observations were included; no third sequence was run.

## Metrics and parity

- AB-READ-001-exact-reply: Direct median/mean 5977.24/5775.24 ms; Workbench median/mean 5734.66/5575.69 ms; thread-start medians 166.77/162.87 ms; turn-start ACK medians 0.94/0.92 ms; token usage available=true; tool calls 0/0; compactions null/null; retries null/null.
- AB-READ-002-package-contract: Direct median/mean 10100.09/10340.33 ms; Workbench median/mean 12011.92/12271.87 ms; thread-start medians 154.42/162.32 ms; turn-start ACK medians 0.93/0.88 ms; token usage available=true; tool calls 4/4; compactions null/null; retries null/null.
- AB-READ-003-native-ownership: Direct median/mean 24311.53/23376.09 ms; Workbench median/mean 20060.01/21915.44 ms; thread-start medians 164.27/164.52 ms; turn-start ACK medians 0.92/0.80 ms; token usage available=true; tool calls 23/23; compactions null/null; retries null/null.
- Actual thread/start and turn/start envelopes were byte-equivalent after normalizing only per-run thread IDs; Workbench-only model-visible fields: none.
- Workbench local turn-request diagnostics were recorded separately and were not treated as model-visible payload.

## Gate and decision

- Repository gate: PASS — npm ci, typecheck, targeted parity 11/11, full npm test 614/614, and build passed once each.
- Static ownership audit: PASS — shared host present; no ordinary Native dynamic tools, Workbench developer instructions, Conversation Map independent runtime, Project Map direct compatibility client, Automation-created runtime, or unclassified/forbidden occurrence.
- Semantic verdict: FAIL
- Performance assessment: MIXED
- Release recommendation: DO_NOT_PROMOTE.
- The required-case failure is an observed model task/validator failure in both arms, not evidence of a Workbench-only request-envelope injection; it remains a failed result because the required mechanical validator did not pass.

## Protocol notes

- Pre-product protocol-audit script parser/field-access corrections were completed before repository gates, model discovery, and formal trials; no product command was duplicated.
- Windows PowerShell captured runner stdout as UTF-16LE; raw event bytes were preserved and decoded only during post-run analysis. This did not change runner inputs or event content.
- The optional AB-WRITE-001-workspace-write stratum was not run; it is explicitly non-required and excluded from the primary required-case verdict.
- No measurement protocol deviation occurred after P1 began: no trial was retried, no formal trial was concurrent, and no third sequence was started.

Raw evidence root: C:\Users\sadar\AppData\Local\Temp\codex-workbench-tests\native-ab-20260829T133257Z-ea3c0e
Independent review: FAIL, recommended verdict FAIL.
