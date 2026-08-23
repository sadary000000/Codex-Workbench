# ARCH-V2-4 FIX-03 Production Lease Correlation

## Authoritative chain

```text
OperationArbiter live operation
  operationId / leaseRef / leaseEpoch / ownerKey
        ↓ read-only snapshot
RequestManager action adapter
        ↓
ProviderRequest.resourceLease
        ↓
ExternalRef(WEBGPT_RESOURCE_LEASE)
        ↓
ResourceClaim.resourceLeaseRef + leaseEpoch
```

`OperationArbiter` remains the only live lease truth. `ResourceClaim` is workflow intent/audit correlation and cannot reconstruct a live lease from historical data. No second lease store was added.

## Test

The production adapter integration test holds a real RequestManager/Arbiter composition at the active-operation boundary and asserts operationId, leaseRef, leaseEpoch and ownerKey are identical through ProviderRequest → ExternalRef → ResourceClaim. The adapter then releases the operation and the manager reaches its terminal state.

## Limitation disclosed

Independent audit found that ResourceClaim lifecycle/release and cross-project ExternalRef validation are not a complete new live state system. They are recorded for GPT review and were not expanded in this round.
