# STAGE-K0 Re-authorized GPT Review Request

Please review the attached `STAGE-K0-REAUTHORIZED-REVIEW-PACKAGE.zip` for the authorized stage only.

## Required response contract

Return both fields explicitly and independently, on their own lines:

```yaml
Gate: PASS | FIX_REQUIRED | BLOCKED | REDESIGN
Status: <independent stage status>
```

Do not infer a Gate from a Status such as `PASS_CANDIDATE` or
`READY_FOR_GPT_REVIEW`. Do not return an unqualified “looks good”.

## Stage boundary

```yaml
stage: STAGE-K0
official_name: Automation Foundation
scope:
  - controlled reuse audit of historical K0 HOLD implementation
  - RequirementOrigin as first-class bounded provenance
  - immutable Requirement version chain
  - persistence and migration rollback
  - complete canonical identity comparison
  - project-scoped PolicyVersion pinning
  - ActionAttempt / ProviderRequest / Observation / Receipt correlation
  - fail-closed generic reconcile boundary
  - opaque InputRef boundary
out_of_scope:
  - Planner
  - Executor
  - Reviewer
  - Scheduler
  - AUT-2 / AUT-3
  - V1 Frozen Core
  - Native Thread / Turn / Item
  - browser UI
  - Submission Runner
```

## Review questions

1. Does every persisted RequirementVersion have explicit, same-project,
   bounded RequirementOrigin provenance without becoming a second content
   truth?
2. Are version chains, duplicate roots, orphan origins, payload hashes, active
   pointers, and migration rollback fail-closed?
3. Does accepted-provider recovery reattach by the existing durable
   idempotency reference without blind resend or silent identity replacement?
4. Do PolicyVersion scope/pin, ActionAttempt, ProviderRequest,
   ProviderObservation, Receipt, and reconcile preserve one correlation?
5. Does the generic reconcile command fail closed instead of bypassing the
   formal Requirement provider boundary?
6. Are the reported tests, package provenance, and frozen-core boundary
   sufficient for the re-authorized STAGE-K0?

If a fix is required, list only the minimal K0-scoped fix scope. Do not advance
to another stage automatically.
