# ARCH-V2-4 Idempotency Evidence

Source: `tests/arch-v2-4-external-action.test.ts` and `tests/webgpt-action-readiness.test.ts`.

## Unknown result

The unknown-provider test observed:

```yaml
first_receipt: UNKNOWN
reconcile_state: RECOVERY_REQUIRED
second_dispatch: rejected / UNKNOWN_OUTCOME_SAME_SIDE_EFFECT
reconcile_submit_count: 1
receipt_count_after_reconcile: 1
```

The explicit reconcile converted the existing receipt to terminal success without a second provider submission.

## Terminal failure retry

The retry test observed two distinct ActionAttempt IDs and two distinct provider request references. The first Receipt was terminal failure; the second dispatch was a new Attempt and succeeded.

## Historical scope

The readiness suite includes 15 unrelated non-terminal historical records. All were classified as `HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE`; none blocked the target action.
