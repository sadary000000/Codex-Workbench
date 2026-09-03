# REPORT-RC-001

Worker status: `BLOCKED`

Todo ID: `RC-001`
Todo: `docs/workbench-coordination/todolist/TODO-RC-001.md`
Claim ID: `RC-001-20260903T185700+0800`
Claim base SHA: `4886b3068013606f440268f6dd5ee14dc4659533`

## Result summary

The exact Recovery product snapshot and the reproducible CI failure were verified, and the bounded Recovery test surface was inspected without changing product code. However, the available GitHub execution surfaces did not expose the raw failing assertion text, expected value, or actual value from the failed Unit/integration step, and the Worker execution environment could not obtain a clean exact-SHA checkout for local reproduction because GitHub source retrieval was blocked by its network/DNS environment.

Because the Todo explicitly requires exact failing test/assertion evidence before any product fix may be defined, this investigation is `BLOCKED` rather than completed. No root cause is claimed and no product patch was made.

## Verified starting state

- Repository: `sadary000000/Codex-Workbench`
- Active branch: `fix/v01-recovery-closure`
- Claim base SHA: `4886b3068013606f440268f6dd5ee14dc4659533`
- Product PR: Draft PR #55, open and not merged during investigation
- Integration base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- Exact product-code snapshot under investigation: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- Exact product tree: `317c892b784ea636427f800f562ca43ab965f21b`
- CI run: `33649460705`
- Attempt 1 job: `100312467323` — FAIL
- Attempt 2 job: `100525705853` — FAIL

## Durable changes

### Product-code snapshot

- Product commit SHA: `1e9d2ea15da176d3744c35bd833bfd4a29b56782` (pre-existing snapshot; Worker did not create or modify it)
- Changed product files by this Worker: none
- Product/source/test/workflow modifications by this Worker: none

### Coordination records

- Claim commit: `cb12cf4c6a84e09d8dd0e2e94c32cdfe155dc671`
- Claim commit changed only `docs/workbench-coordination/todolist/TODO-RC-001.md`
- Investigation report: `docs/workbench-coordination/reports/REPORT-RC-001.md`
- PR/ref authority changes: none

## Validation performed

| Check | Result | Evidence |
|---|---|---|
| Exact product snapshot exists | PASS | commit `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, tree `317c892b784ea636427f800f562ca43ab965f21b` |
| CI run targets exact product snapshot | PASS | run `33649460705`, head SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782` |
| Attempt 1 Unit/integration | FAIL | job `100312467323`; Typecheck PASS, Unit/integration FAIL, Build SKIPPED |
| Attempt 2 Unit/integration | FAIL | job `100525705853`; Typecheck PASS, Unit/integration FAIL, Build SKIPPED |
| Exact CI test command identified | PASS | Node 22 workflow runs `npm test`; package script is `node --experimental-strip-types --test "tests/**/*.test.ts"` |
| Raw failing test/assertion from latest job | BLOCKED | available job/check surfaces exposed step failure/exit status but did not yield raw assertion, expected value, or actual value |
| Exact-SHA local reproduction | BLOCKED | Worker container could not retrieve GitHub source because of its network/DNS restriction, so a clean exact-SHA checkout and local `npm test` could not be established |
| Recovery test source inspected on exact SHA | PASS | `tests/v01-step-recovery-closure.test.ts` at `1e9d2ea...` |
| Product-code diff produced by Worker | PASS (none) | claim commit `cb12cf4...` changes only the Todo coordination file; no product/source/test/workflow write was performed |

## Inspected Recovery test surface

The following tests/assertions were inspected on exact SHA `1e9d2ea...` as relevant Recovery regression surface. They are **not asserted to be the tests that failed in CI**, because raw CI output is still unavailable:

- `definitive PURE failure projects Retry and creates Attempt #2 without deleting Attempt #1`
  - expects first execution `FAILED`, governance `RECOVERABLE` + `RETRY`, second execution `VERIFYING`, a distinct Attempt #2, Attempt #1 preserved `FAILED`, Attempt #2 `COMPLETED`, and two step-execution intents.
- `RECONCILABLE NOT_DISPATCHED failure requires fresh confirmation before Retry/New Attempt`
  - expects failed receipt `NOT_DISPATCHED:*`, a retry without fresh approval to reject with `STEP_EXECUTION_SIDE_EFFECT_APPROVAL_REQUIRED`, and approved retry to create Attempt #2 with `USER_CONFIRMED` side-effect approval.
- `restart reconcile reattaches an already-existing Native Turn by correlation and never starts another Turn`
  - expects restart recovery to correlate and reattach an existing Native Turn, perform zero replacement starts, and end with the recovered execution attempt `COMPLETED`.
- `restart Governance deterministically catches up persisted verification and review Evidence without creating new Evidence`
  - expects persisted verification Evidence to advance runtime to `REVIEWING`, persisted review Evidence to advance it to `TERMINAL`, `terminalResult === "COMPLETED"`, and no duplicate verification/review Evidence.
- `abnormal current Step is always Recoverable or Explicitly Blocked, never a silent no-exit state`
  - checks the Recovery invariant that an abnormal current Step has a legal recovery action or an explicit Blocked disposition.

This source inspection narrows the relevant lifecycle areas, but without the actual CI assertion it does not identify which test or assertion failed.

## Acceptance criteria assessment

- [ ] Identify every failing test needed to explain the Unit/integration failure — **BLOCKED**; CI raw failure output unavailable.
- [ ] Record exact failing assertion / expected / actual — **BLOCKED**; not exposed by available log surface and exact local reproduction unavailable.
- [x] Record exact evidence source / run / jobs — run `33649460705`, jobs `100312467323` and `100525705853`.
- [ ] Provide evidence-backed failing lifecycle and smallest correction target — **BLOCKED**; selecting a correction without the assertion would be speculative.
- [x] Classify stale `StepRuntime.terminalResult` lead — `UNRELATED/INSUFFICIENT_EVIDENCE` for purposes of defining the CI root cause.
- [x] Make zero product/source/test/workflow changes — satisfied.

## Confirmed findings

- The Unit/integration regression is reproducible on exact product SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782`: the same test stage failed in both CI attempts while Typecheck passed and Build was skipped.
- CI executes Node 22, `npm ci`, `npm run typecheck`, `npm test`, then Build only if tests succeed.
- At this product SHA, `npm test` is `node --experimental-strip-types --test "tests/**/*.test.ts"`.
- The Recovery tests cover at least two distinct lifecycle paths relevant to the debugging lead: Retry/new-attempt behavior and restart catch-up over already-persisted verification/review Evidence.
- No product code, source, tests, or workflow files were modified by this Worker.

## Stale `StepRuntime.terminalResult` lead

Classification: `UNRELATED/INSUFFICIENT_EVIDENCE`.

Rationale:

- The durable Recovery checkpoint explicitly records stale `terminalResult` after Retry/new-attempt as only a plausible, unverified debugging lead.
- The checkpoint also records that the restart catch-up test creates a completed ExecutionAttempt directly and does not traverse the failed-Retry path, so the paths cannot be conflated.
- Exact-source inspection confirms the restart Governance catch-up test expects persisted Evidence to advance `VERIFYING -> REVIEWING -> TERMINAL` and end with `terminalResult === "COMPLETED"`.
- Because the raw CI assertion is unavailable, there is no evidence tying the actual failure to stale `terminalResult`; promoting it to root cause would violate the Todo.

## Unverified hypotheses

- A stale `StepRuntime.terminalResult` may still affect some Retry/new-attempt transition into later verification/review states, but this is not proven to be the failing CI path.
- One or more assertions in `tests/v01-step-recovery-closure.test.ts` may be responsible for the CI failure, but the current evidence cannot identify which one(s).

## Remaining / blocked work

The exact assertion must be obtained by one of these evidence-producing routes before defining a product-fix Todo:

1. retrieve raw `npm test` output / full job log for latest job `100525705853` in an environment or GitHub surface that exposes the Node test runner assertion; or
2. run the exact `npm test` command from a clean checkout of `1e9d2ea15da176d3744c35bd833bfd4a29b56782` in an environment with working repository/dependency access.

Until then, a correction target would require guessing and is not authorized.

## Non-durable work

- No unsaved product code exists.
- No local patch exists.
- The local reproduction route was not established because source retrieval was blocked before tests could run.

## Recommended first next action

`Project Lead should provide or dispatch an environment that can expose the raw output of job 100525705853 or reproduce npm test on exact SHA 1e9d2ea15da176d3744c35bd833bfd4a29b56782; only after the exact failing assertion is known should it create the smallest bounded product-fix Todo.`

## Worker note to Project Lead

This report is a truthful `BLOCKED` handoff for independent Project Lead review. It is not an acceptance or a product-fix recommendation.
