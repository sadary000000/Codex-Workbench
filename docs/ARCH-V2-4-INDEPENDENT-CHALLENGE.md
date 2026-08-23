# ARCH-V2-4 FIX ROUND 2 — Independent Challenge

## Adopted hardening

The independent safety audit identified a gap between provider request identity and the input/intent target. The main agent added:

- canonical project equality;
- role equality when supplied;
- canonical target equality across input, dispatch facts and request record;
- ProviderRequest ExternalRef project/kind/provider/opaqueId checks;
- provider request target equality before observation/receipt mutation.

The new mismatch test is included in the 322-test full suite.

## Deferred findings

The following were not part of the GPT-authorized FIX-01..03 and were not modified:

- ResourceClaim terminal lifecycle versus OperationArbiter live lease interpretation;
- removal of legacy test-only dispatchContext or activation of Requirement/Planner production callers.

They are explicitly documented rather than silently expanded into this round.
