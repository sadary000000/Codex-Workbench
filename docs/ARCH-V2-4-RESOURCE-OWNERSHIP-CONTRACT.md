# ARCH-V2-4 Resource Ownership Contract

## One live owner

`WebGptOperationArbiter` remains the only live browser ownership mechanism. Its capacity is one. ARCH-V2-4 adds a monotonic in-process `leaseEpoch` to the existing operation identity and diagnostics.

`ResourceClaim` is an Automation persistence record, not a second live lease. When a provider adapter returns a lease snapshot, the bridge stores an `ExternalRef(kind=WEBGPT_RESOURCE_LEASE)` and maps its reference and epoch onto the existing claim.

## Required mapping

```yaml
resourceClaim.ownerAttemptId: ActionAttempt.actionAttemptId
resourceClaim.resourceLeaseRef: ExternalRef.externalRefId
resourceClaim.leaseEpoch: existing OperationArbiter/provider epoch
```

The bridge does not acquire, release, or reconstruct live browser ownership. It cannot turn a historical RequestRecord into an active lease.

## Safety rules

- A live resource blocker fails closed before dispatch.
- A stale/unknown lease cannot be treated as available merely because a Journal entry is historical.
- Resource references remain project-scoped by schema validation.
- No production Journal cleanup or lease migration is performed.
