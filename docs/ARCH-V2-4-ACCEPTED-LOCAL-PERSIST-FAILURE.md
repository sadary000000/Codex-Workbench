# ARCH-V2-4 FIX-04 Accepted Provider / Local Persistence Failure

## Required semantics

```text
provider.submit accepted
→ local ExternalRef/Evidence/Receipt persistence throws
→ UNKNOWN + RECOVERY_REQUIRED
→ no automatic redispatch
→ explicit reconcile/reattach only
```

## Evidence

Fault injection covers one-shot failure in ExternalRef, Evidence and Receipt persistence. The provider submit count is 1. The recovery path preserves the accepted ProviderRequest, creates/fetches bounded correlation evidence, and explicit `reconcile()` updates the same receipt without calling `submit`.

Normal provider submit throw remains a separate `FAILED + NOT_REQUIRED` path. It is not conflated with accepted-but-local-persist-failed.

## Test result

`tests/arch-v2-4-fix-round-1.test.ts` and the existing external-action tests pass. A future repeated/continuous store failure test is not part of this round and is disclosed, not silently assumed.
