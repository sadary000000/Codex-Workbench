# STAGE-K0 Test Contract and Results

Date: `2026-08-25`

## Required commands

| command | result | evidence |
|---|---|---|
| `npm run check` | PASS | typecheck and test typecheck completed before final package |
| `npm test` | PASS | full suite: 438/438 before final K0-only test additions |
| `npm audit --omit=dev` | PENDING FINAL RUN | recorded at final gate |
| `git diff --check` | PASS | no whitespace errors; CRLF warnings only |
| `npm run build` | PENDING FINAL RUN | recorded at final gate |
| `npm run package:win` | PENDING FINAL RUN | recorded at final gate |
| secret scan | PENDING FINAL RUN | only source/docs/package inputs; no credential material permitted |

## Targeted coverage already exercised

- explicit RequirementOrigin and same-project origin validation;
- immutable Requirement payload/hash and immediate predecessor chain;
- duplicate version/root and orphan-origin rejection;
- v0/v1/v2/v3 → v4 compatibility;
- full migration document equivalence and interrupted migration recovery;
- SQLite transaction rollback and JSON backup restoration;
- policy pin/scope and ActionIntent/ActionAttempt correlation;
- accepted-provider request reattachment by idempotency reference;
- observation correlation and reconcile-only unknown outcomes;
- generic reconcile fail-closed boundary;
- AUT-R0 Requirement provider regression.

The pre-documentation targeted run was `60/60 PASS`; the full suite was
`438/438 PASS`. The final command matrix below is authoritative once the
implementation commit and package are created.

## Real operations

```text
real business prompts: 0
new business chats: 0
```

K0 is a foundation stage. No real Prompt is required or permitted by the
stage scope. Existing contract, unit, persistence, and provider-boundary
evidence is sufficient for this gate.

## Final gate record

The final report must include exact exit codes, test counts, build/package
paths, package hash, and secret-scan scope. A green unit suite alone cannot be
reported as the K0 Gate.
