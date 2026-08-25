# STAGE-K0 Reality Check

Date: `2026-08-25` (Asia/Shanghai)
Status: `IMPLEMENTATION_CLOSED_PENDING_FINAL_GATE`

## Scope and source localization

The current production Automation boundary is under `src/automation`. The
relevant persistence and domain sources are:

- `types.ts`, `schema.ts`, `store.ts`
- `sqlite-persistence.ts`, `migration-contract.ts`, `migration-identity.ts`
- `stable-identity.ts`, `composition-root.ts`
- `effective-policy.ts`, `webgpt-policy-authority.ts`
- `requirement-provider-dispatch.ts`, `evidence-correlation.ts`,
  `recovery-intent.ts`

The current Automation schema is version 4. The existing policy/action/recovery
chain is already present and K0 extends its durable Requirement boundary; K0
does not create another runtime or conversation truth.

## Historical finding matrix

| historical finding | current disposition | evidence |
|---|---|---|
| RequirementOrigin was not first-class | CLOSED IN K0 | `types.ts`, `schema.ts`, `store.ts`, `requirement-service.ts`; origin is a bounded persisted collection and every RequirementVersion has an explicit `originRef` |
| Requirement immutability/version chain was incomplete | CLOSED IN K0 | immutable-field checks, duplicate/root checks, and immediate predecessor validation in `store.ts` and `schema.ts` |
| migration rollback/interruption path was incomplete | CLOSED IN K0 | v3→v4 upgrade, full-document equivalence, source backup restoration, transactional SQLite rewrite, and JSON promotion rollback |
| identity comparison did not include the new Requirement collection | CLOSED IN K0 | `migration-identity.ts` compares the complete canonical document, including version, supersedes, hashes, origins, and payload identity |
| PolicyVersion scope/pin mismatch risk | CLOSED IN K0 | policy evaluation accepts the dispatch project scope; side-effect intents require a policy pin; no latest-policy fallback was added |
| accepted side-effect correlation durability risk | CLOSED IN K0 AS FAIL-CLOSED RECOVERY | an accepted request can be reattached by the durable idempotency reference through `resolveRequestByCorrelation`; missing local correlation blocks resend and enters reconcile-only recovery |
| direct reconcile seam bypass risk | CLOSED IN K0 | generic `webgpt.request.reconcile` is fail-closed; formal Requirement reconcile carries ActionAttempt and Provider correlation |
| duplicate Requirement roots/orphan origins | CLOSED IN K0 | schema validation rejects duplicate `(projectId, version)`, multiple version-1 roots, orphan origins, and cross-project references |

## K0 implementation facts

1. `RequirementOrigin` is persisted, project-scoped, bounded, and referenced by
   `RequirementVersion.originRef`.
2. A version 1 Requirement has no predecessor; every later version must name
   the immediately previous version and supersede it atomically.
3. Legacy v0/v1/v2/v3 documents receive deterministic bounded origin records
   during migration. Existing safe origin references are preserved when their
   origin row is absent in a legacy source; new low-level Requirement callers
   must provide an explicit origin and cannot trigger an implicit origin.
4. SQLite v2/v3 migration writes the upgraded document in one transaction and
   retains a source backup. Failure rolls back the canonical database. JSON
   promotion restores the source backup if candidate promotion fails.
5. The raw Requirement/Prompt remains outside the durable Automation document;
   the existing opaque InputRef boundary is unchanged.
6. Provider acceptance without a durable local request reference is not treated
   as failure and is not retried blindly: the formal reconcile path resolves
   the provider request by the already-persisted idempotency reference, then
   persists the recovered correlation or returns `RECOVERY_REQUIRED`.

## Boundary result

No V1 Frozen Core, Native Thread/Turn/Item, browser/conversation ownership, or
Submission Runner file was changed for K0. The existing WebGPT adapter was
changed only at the integration seam to carry project-scoped correlation,
reattach an already accepted request, and fail-closed the generic reconcile
entry point; this does not introduce a second runtime or conversation truth.
No real business Prompt or new business Chat was used.

## Gate accounting

The initial four-agent challenge found P0/P1 risks. Each is either closed by
the K0 patch above or explicitly outside the K0 product boundary. The final
gate must still be backed by the commands and package evidence recorded in
`STAGE-K0-TESTS.md` and `STAGE-K0-STAGE-REVIEW.md`; this document is not a
substitute for the final GPT Gate.
