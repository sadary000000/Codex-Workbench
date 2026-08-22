# ARCH-V2-4 Resource Lease Evidence

Source: isolated provider fixture in `tests/arch-v2-4-external-action.test.ts`.

The provider returned:

```yaml
leaseRef: <bounded fixture reference>
leaseEpoch: 1
```

The bridge persisted an `ExternalRef` of kind `WEBGPT_RESOURCE_LEASE` and attached its ID plus epoch to the existing `ResourceClaim`. The test asserted `ResourceClaim.state=ACQUIRED` and a non-null mapped lease reference.

The implementation does not add a second live lease registry. Existing real arbiter evidence remains a separate regression boundary; a provider lease snapshot is required before a persisted claim is marked mapped/acquired.
