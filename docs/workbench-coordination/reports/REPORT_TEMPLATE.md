# REPORT-<TODO-ID>

Worker status: `<COMPLETED | BLOCKED | FAILED | INTERRUPTED>`

Todo: `docs/workbench-coordination/todolist/TODO-<TODO-ID>.md`

## Claim

- Claim ID: `<id>`
- Claim base SHA: `<sha>`
- Claimed at: `<timestamp>`

## Result summary

State what was actually achieved. Do not describe intended but unperformed work as completed.

## Verified starting state

- Repository: `sadary000000/Codex-Workbench`
- Starting ref/branch: `<ref>`
- Starting SHA: `<sha>`
- Relevant PR/CI at start: `<ids/state>`
- Product snapshot under task: `<sha | none>`

## Execution requirements / capability preflight

- Required capabilities: `<list>`
- Pre-claim checks performed: `<checks>`
- Current environment satisfied them: `<YES | PARTIAL | NO>`

## Durable changes

### Product-code snapshot

- Product commit SHA: `<sha | none>`
- Changed product files: `<list | none>`
- Commit purpose: `<summary | none>`

The product commit is the code snapshot to which product validation claims apply. Later report/checkpoint/Todo docs commits are not automatically product validation snapshots.

### Other durable records

- Docs/report commits: `<sha(s) if known, otherwise "inspect branch history">`
- PR/ref changes: `<exact changes | none>`

## Validation performed

| Check | Result | Evidence |
|---|---|---|
| `<command/gate>` | `<PASS/FAIL/NOT RUN/BLOCKED>` | `<run/job/log/summary>` |

Do not reuse old validation from another product SHA as proof for this result.

## Acceptance criteria assessment

- [ ] `<criterion>` — `<evidence>`
- [ ] `<criterion>` — `<evidence>`

If any required criterion is not satisfied, Worker status must not imply full completion.

## Fallback routes attempted

Record the ordered routes from the Todo and what happened.

1. `<route>` — `<outcome/evidence>`
2. `<route>` — `<outcome/evidence>`

Do not repeat a route already proven unavailable in a prior attempt unless the current environment materially differs.

## Confirmed findings

- `<fact supported by source/Git/CI>`

## Unverified hypotheses

- `<hypothesis, or none>`

Never mix hypotheses into Confirmed findings.

## Blocker record

Complete this section for `BLOCKED` or `INTERRUPTED`; otherwise write `none`.

- Classification: `<ENVIRONMENT_MISMATCH | EXTERNAL_DEPENDENCY | OWNER_DECISION_REQUIRED | WRITE_COLLISION | TASK_DEFINITION_GAP | INTERRUPTED | OTHER_VERIFIED_BLOCKER | none>`
- Missing capability/dependency/authority: `<exact item | none>`
- Evidence already obtained: `<summary>`
- Exact unblock condition: `<condition | none>`
- Same-goal retry in another environment is side-effect safe: `<YES | NO | CONDITIONAL | N/A>`
- Recommended execution requirements for safe retry: `<requirements | none>`
- Routes that should not be repeated unchanged: `<list | none>`

## Remaining / blocked work

- `<remaining item, blocker, or none>`

## Non-durable work

- `<unsaved/local-only work, or none>`

If work is not in GitHub/durable storage, state that explicitly. Do not reconstruct it from memory and call it saved.

## Recommended first next action

`<one concrete action the Project Lead or follow-up Worker should take next>`

Do **not** write a long bespoke prompt for another Worker. Encode the technical handoff in this report/Todo. The Project Lead will decide whether to requeue the same Todo, keep it blocked, ask the owner, or create a different follow-up Todo.

## Worker note to Project Lead

This report is ready for independent Project Lead verification. Worker `COMPLETED` does not equal Project Lead `ACCEPTED`; Worker `BLOCKED` does not authorize self-requeue.
