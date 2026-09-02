# TASK-<ID>

Status: `DRAFT`

Created by: Workbench Project Lead

## Goal

State one bounded outcome. Do not combine unrelated goals.

## Why now

Explain which current blocker, gate, or approved next step this Task advances.

## Live context to verify before work

- Repository: `sadary000000/Codex-Workbench`
- Working ref/branch: `<exact branch or ref to verify>`
- Integration/base ref: `<if relevant>`
- Expected starting product snapshot: `<SHA or "resolve from current checkpoint">`
- Related PR: `<if relevant>`
- Required checkpoint/context files:
  - `<path>`

Do not trust these cached values if live GitHub truth has moved. Report material drift before writing.

## Allowed scope

- `<allowed file/area/action>`

## Forbidden scope

- no unrelated refactor
- no project-wide replanning
- no frozen-scope expansion
- no merge / branch deletion / Draft->Ready / release advancement unless separately authorized
- `<task-specific prohibitions>`

## Dependencies

- `<Task IDs or external conditions, or "none">`

## Write / concurrency ownership

Mode: `<READ_ONLY | WRITE>`

Owned area/ref: `<explicit files/area/branch>`

Concurrent constraints: `<what must not be modified concurrently>`

## Required work

1. `<step>`
2. `<step>`
3. `<step>`

## Acceptance criteria

- [ ] `<observable criterion>`
- [ ] `<required test/CI/gate>`
- [ ] exact product-code snapshot is recorded
- [ ] failures/unknowns are not represented as PASS

## Required durable outputs

- Product commit(s): `<required / not applicable>`
- Test/CI evidence: `<required evidence>`
- Report: `docs/workbench-coordination/reports/REPORT-<ID>.md`

## Stop / block conditions

Stop and report `BLOCKED` rather than improvising if:

- the task requires a product/scope decision not already approved
- required authorization, credentials, or external dependency is missing
- live Git state materially conflicts with the assigned write assumptions
- another Task owns an overlapping write area/ref
- safe completion would require violating Forbidden scope

## Worker dispatch phrase

`Execute Workbench TASK-<ID>.`
