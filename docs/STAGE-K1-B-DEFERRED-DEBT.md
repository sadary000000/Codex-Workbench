# STAGE-K1-B Deferred Debt

The following are deliberately not implemented in K1-B:

- Candidate promotion into durable Plan/Stage/Step records.
- Rewiring the historical `persistPlannerPlan` Provider path.
- Planner/WebGPT integration or real Planner smoke.
- Step execution, Executor, Native Thread, Workflow, Scheduler, Reviewer or Automation continuation.
- A database migration for any new K1-B-only artifact; the Validator is in-memory and schema-neutral.
- Persistence-side enforcement of every Candidate semantic rule; that is a separate promotion/persistence task and must reuse this validator rather than duplicate it.
- Acceptance-language formalization beyond bounded non-empty/actionability checks.
- Automatic answers for blocking Requirement questions.

These are scope boundaries, not silently accepted failures. They remain deferred until a new stage explicitly authorizes them.
