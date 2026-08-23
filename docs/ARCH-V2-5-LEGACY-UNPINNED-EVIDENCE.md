# ARCH-V2-5 Legacy Unpinned Evidence

## Input

An old Request Journal record may not contain policyVersionId. The loader preserves
that fact as null and does not invent a PolicyVersion or mutate the record merely
because it was inspected.

## Allowed

- get/status/readLatest/inspect/display;
- diagnostic evidence and recovery classification;
- explicit future pin/migrate/authorize command.

## Blocked

With normal production manager configuration, a missing pin blocks PROMPT, REPAIR,
RETRY, NEW_CHAT and any irreversible browser/provider mutation.

The error is POLICY_PIN_REQUIRED. A record with a non-existent, wrong-project or
corrupted pin fails with POLICY_PIN_INVALID/POLICY_PIN_MISMATCH. The implementation
never calls resolveCurrentPolicy as a fallback for an old record during dispatch.

## Test

The regression named
a legacy unpinned journal fails closed instead of falling back to the latest policy
removes policyVersionId from a persisted queued record, reopens it, reattaches by
the same idempotency key, and proves:

- state becomes FAILED;
- error code is POLICY_PIN_REQUIRED;
- fake workspace submitPrompt count stays zero.

## Compatibility boundary

New production commands acquire a read-only current PolicyVersion ID before the
Request record is persisted. This is pin acquisition, not budget reservation.
Existing historical records are not auto-migrated or silently rebound.
