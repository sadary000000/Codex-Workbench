# REPORT-<TASK-ID>

Worker status: `<COMPLETED | BLOCKED | FAILED | INTERRUPTED>`

Task: `docs/workbench-coordination/tasks/TASK-<TASK-ID>.md`

## Result summary

State what was actually achieved. Do not describe intended but unperformed work as completed.

## Verified starting state

- Repository: `sadary000000/Codex-Workbench`
- Starting ref/branch: `<ref>`
- Starting SHA: `<sha>`
- Relevant PR/CI at start: `<ids/state>`

## Durable changes

### Product-code snapshot

- Product commit SHA: `<sha | none>`
- Changed product files: `<list | none>`
- Commit purpose: `<summary>`

The product commit is the code snapshot to which product validation claims apply. Later report/checkpoint docs commits are not automatically product validation snapshots.

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

## Confirmed findings

- `<fact supported by source/Git/CI>`

## Unverified hypotheses

- `<hypothesis, or none>`

Never mix hypotheses into Confirmed findings.

## Remaining / blocked work

- `<remaining item, blocker, or none>`

## Non-durable work

- `<unsaved/local-only work, or none>`

If work is not in GitHub/durable storage, state that explicitly. Do not reconstruct it from memory and call it saved.

## Recommended first next action

`<one concrete action the Project Lead or follow-up Worker should take next>`

## Worker note to Project Lead

This report is ready for independent Project Lead verification. Worker `COMPLETED` does not equal Project Lead `ACCEPTED`.
