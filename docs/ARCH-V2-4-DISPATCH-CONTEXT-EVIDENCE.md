# ARCH-V2-4 FIX-05 Dispatch Context Evidence

## Composition

`buildWebGptDispatchContext()` consumes:

- existing `classifyWebGptActionReadiness()`;
- current request records and unavailable IDs;
- Browser Arbiter diagnostics/live resource facts;
- authoritative runtime readiness, policy and target identity facts.

`canDispatch()` remains a pure conjunction and does not read or mutate persistence. The legacy seven-boolean context is retained only as a test compatibility escape hatch; production composition uses `dispatchFacts`.

## Matrix

| Scenario | Expected | Result |
|---|---|---|
| 15 unrelated historical records + Browser FREE | dispatchable | PASS |
| same-side-effect unknown | blocked | PASS |
| live Browser lease | blocked | PASS |
| same idempotency key + semantic drift | blocked | PASS |
| same key + same semantic RequestManager retry | reuse original Request | PASS at RequestManager layer |

## Remaining evidence gap

Readiness returns `reattachRequestId`, but the Bridge does not yet carry that field through dispatch. Therefore the current evidence does not prove Bridge-level Attempt/ProviderRequest reuse. This is reported as `FIX-05 FAIL_WITH_EVIDENCE`; no additional product fix was invented in this round.
