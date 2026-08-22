# AUT-2 Fix8 First-Round Real Evidence

## Invocation boundary

- Packaged GUI: `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`
- Packaged CLI was invoked by Node `execFile`; no PowerShell executable invocation was used.
- Project: `workts`
- Project ID: `371c3fb8-30ac-4943-9584-1915045ea34d`
- Existing canonical Chat: `https://chatgpt.com/g/g-p-6a85db5dd9c4819181028671e2fb9315-workts/c/6a891d7c-abf4-83e8-879a-d477e472576a`
- REQUIREMENT original binding was restored after the run.

## Budget and side effects

| Counter | This run | Cumulative |
|---|---:|---:|
| Business original Prompt | 1 | 5 |
| Repair Prompt | 0 | 3 |
| Setup Prompt | 0 | 2 |
| New Chat | 0 | 2 |
| Total real Prompt | 1 | 10/12 |

No answer Prompt, draft closure, user confirmation, new Chat, or Role setup was executed. The real Prompt body and response body were not written to disk.

## Protocol result

- `requestId`: `wgpt-f0c1b5c8-096a-4377-9377-12a59e1aa70d`
- response SHA-256: `ea0bb932653e4bc774ddbbc106b0e6a41131bcc06e14245349cf111c67f2c090`
- response length: `1231` characters
- JSON parse: `passed`
- schema validation: `passed`
- semantic validation: `passed`
- status: `NEEDS_INPUT`
- question count: `5`
- validation issues: `[]`
- repair triggered: `false`

The response-level protocol result therefore proves that the Fix8 Prompt contract corrected the previous `SINGLE_SELECT` schema drift.

## Gate result

The production service could not persist the returned questions. The run failed closed with:

```text
AUTOMATION_SCHEMA_INVALID: round:<sanitized-id>.questionIds crosses a round boundary.
```

This occurred after the response had already passed schema/semantic validation. It is a separate Requirement round identity/persistence defect. The Gate is therefore:

```text
real_first_round: FAIL
first_round_status: FAIL
schema_fix: PASS
overall: FIX_REQUIRED
```

Machine evidence: [`AUT-2-FIX8-FIRST-ROUND-REAL-EVIDENCE.json`](AUT-2-FIX8-FIRST-ROUND-REAL-EVIDENCE.json).
