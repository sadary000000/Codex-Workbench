# STAGE-K0 Automation Foundation Contract

## Goal

Provide a durable Automation domain foundation without creating a second
Conversation, Transcript, Task, Agent-lifecycle, or Context truth. Native
Thread/Turn/Item and Codex App Server remain authoritative for runtime facts.

## Durable ownership

```text
AutomationProject
  ├─ RequirementOrigin → RequirementVersion chain
  ├─ pinned PolicyVersion
  ├─ Plan/Stage/Step specifications
  └─ ActionIntent → ActionAttempt → ActionReceipt
                         └─ Evidence/Observation correlation
```

`RequirementOrigin` records where a bounded Requirement version came from. It
does not own the raw requirement text, a Chat transcript, or a provider result.

```yaml
RequirementOrigin:
  requirementOriginId: bounded opaque id
  projectId: owning Automation project
  originType: INITIAL | REVISION | DISCOVERY | RECOVERY | IMPORT
  source: USER | WEBGPT | PROJECT_EVIDENCE | SYSTEM | IMPORT
  sourceRef: bounded non-URL reference or null
  createdAt: canonical timestamp
```

`RequirementVersion.originRef` must resolve to an origin in the same project.
Low-level Requirement writers must provide an explicit origin or originRef;
there is no implicit origin fallback. Raw prompt content is not copied into
the origin or version record.

## Immutability and chain rules

- Persisted versions are immutable after insertion except for the existing
  terminal/status projection rules.
- `canonicalPayload` is canonicalized and hash-bound.
- Version 1 has `supersedes: null`.
- Version N>1 must name version N-1 from the same project.
- A missing predecessor, a non-immediate predecessor, cross-project origin, or
  origin URL is rejected fail-closed.
- Duplicate `(projectId, version)` rows, multiple version-1 roots, and orphan
  origin rows are rejected by the schema boundary.
- Transaction reads return clones; mutation is only committed through the
  transaction writer and immutable fields cannot be replaced.

## Execution boundary

```text
PolicyVersion pin
  → EffectivePolicy
  → RuntimeCapability
  → ActionIntent
  → ActionAttempt
  → ProviderRequest
  → ProviderObservation / Receipt
  → Reconcile
```

K0 does not add an execution engine or bypass the existing provider/action
boundary. If a provider accepts a request before its local reference is
persisted, the durable idempotency reference is used for reconcile-only
reattachment; unresolved correlation returns `RECOVERY_REQUIRED` and never
blindly dispatches again. The generic WebGPT reconcile command is fail-closed
and cannot bypass this formal boundary.
