# ARCH-V2-4 Reconcile Evidence

The isolated unknown-outcome fixture executed the following sequence:

```text
submit once
  -> provider accepted
  -> observation unavailable / ACCEPTED_UNKNOWN_RESULT
  -> one UNKNOWN ActionReceipt / RECOVERY_REQUIRED
  -> explicit reconcile
  -> terminal observation
  -> same Receipt updated / RECONCILED
```

The provider submit counter remained `1`. The bridge never called provider submit during reconcile. This proves the no-resend boundary for the implemented adapter contract.

Real AUT-2/AUT-3 WebGPT Prompt and real external side effect were intentionally not used.
