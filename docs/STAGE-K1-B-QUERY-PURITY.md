# STAGE-K1-B Query Purity

The new API is a pure boundary:

- `normalizePlanCandidate` creates a detached normalized value and does not mutate its input.
- `validatePlanCandidate` only reads the candidate and context.
- `validatePlanVersionTransition` only returns an issue list.
- `createPlannerValidationContext` reads an `AutomationDocument`; it does not persist or activate anything.
- `validatePlanCandidateAgainstDocument` composes the two pure operations.

It does not import `AutomationStore`, Planner Provider, WebGPT Runtime, Executor, Native Thread, browser state, or shell execution. It cannot create a StepRuntime or ActionAttempt. Candidate allowlists reject runtime authorization and raw Requirement content fields.

The deterministic test suite snapshots candidate/context before validation and verifies both are unchanged. A future promotion seam must preserve this ordering:

```text
untrusted candidate
  -> normalize + validate
  -> explicit persistence command
  -> explicit active selection command
```
