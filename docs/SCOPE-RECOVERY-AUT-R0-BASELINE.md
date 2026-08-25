# Scope Recovery — AUT-R0 Baseline Restore

Date: `2026-08-25` (Asia/Shanghai)
Result: `RESTORED`

## Scope decision

The previous STAGE-K0 work was outside the authorized recovery request. The
formal mainline is restored to the AUT-R0 frozen baseline. K0 implementation,
tests, commits, review evidence, and package artifacts are retained for audit,
but are classified as:

```yaml
k0_status: HOLD_NOT_MAINLINE
lifecycle: HOLD / EXPERIMENTAL IMPLEMENTATION
```

No K0 work is continued by this recovery.

## Commit disposition

```yaml
aut_r0_baseline: 392b4f7a0fbf2f21befef40d5a4ecc47b0982e0f
k0_implementation_commit: ece5363ddb13272678f25ad7f72e0e9c09ebcd45
k0_review_commit: 20df306
k0_gate_record_commit: 4e4ce77
```

The three K0 commits remain in history. A new scope-recovery revert commit
removes their implementation and test changes from the mainline without using
`git reset --hard`.

## Database check

No `automation.db` or `automation.db*` candidate was found in the Workbench
project or the checked Workbench user-data directories. No AUT2/AUT3 database
override environment variable was present during the check.

```yaml
production_database_changed: NO
```

## Protected boundaries

- V1 Frozen Core / Native Thread / Turn / Item: unchanged by the K0 revert.
- Submission Runner: not modified by this recovery.
- WebGPT: K0-touched WebGPT integration files are returned to the AUT-R0
  baseline; unrelated pre-existing dirty files are preserved.
- User dirty worktree files, historical review packages, and user documents:
  not cleaned, reset, or deleted.

## Verification required after commit

```text
npm run check
npm test
npm audit --omit=dev
git diff --check
npm run build
npm run package:win
```

Observed during this recovery:

| check | result | note |
|---|---|---|
| `npm run check` in current worktree | FAIL | pre-existing uncommitted AUT-R0/AUT-2 test additions reference K0-only fields |
| `npm test` in current worktree | FAIL, 429/437 | the same preserved dirty files fail 8 assertions after K0 contracts are removed |
| clean AUT-R0 baseline `npm run check` | PASS | verified in a temporary worktree at `392b4f7` |
| clean AUT-R0 baseline `npm test` | FAIL, 414/415 | one pre-existing `workspace-layout-contract` assertion fails at the baseline commit |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities |
| `git diff --check` | PASS | only normal line-ending warnings |
| `npm run build` | PASS | control-plane schema and build passed |
| `npm run package:win` | PASS | both GUI and CLI packages produced |

The failures were not changed or hidden because fixing them would exceed this
scope-recovery task and would mutate preserved user work. The recovery does
not submit to GPT and does not enter STAGE-K0 or another stage. The next action
is new stage authorization.
