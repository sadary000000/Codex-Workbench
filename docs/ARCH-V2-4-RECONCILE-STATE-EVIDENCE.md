# ARCH-V2-4 FIX-06 Reconcile State Evidence

## State rule

```text
normal submit → provider observe terminal → reconcileState=NOT_REQUIRED
UNKNOWN/recovery-only → explicit reconcile terminal → reconcileState=RECONCILED
```

The bridge sets `explicitReconcile=false` for normal observation and `true` only for `reconcile()`. Existing UNKNOWN receipts are reconciled in place; no new Attempt and no provider submit are created.

## Tests

External-action and FIX ROUND 1 tests assert both terminal paths and the no-redispatch invariant. Provider submit failures remain `FAILED/NOT_REQUIRED`, while accepted-unknown remains `UNKNOWN/RECOVERY_REQUIRED` until explicit reconcile.
