# STAGE-K0 Deferred Debt

These items are deliberately outside the re-authorized Automation Foundation scope. They are not permission to weaken fail-closed behavior.

| item | disposition |
|---|---|
| Planner / Executor / Reviewer / Scheduler | deferred to later authorized stage |
| AUT-2 / AUT-3 orchestration | deferred; no stage transition implied |
| multi-project scheduling | deferred |
| browser/session UI and WebGPT product behavior | deferred; no K0 implementation |
| Submission Runner product changes | deferred and unchanged |
| full encrypted secret/session storage | deferred; no credentials stored |
| accepted provider side-effect with missing identity | `RECOVERY_REQUIRED`; never blind retry |
| durable raw Requirement content | intentionally excluded; opaque InputRef remains the boundary |
| generic reconcile policy expansion | deferred; current reconcile is fail-closed |

No deferred item permits wrong-thread sends, silent identity replacement, duplicate Prompt, a second Conversation truth, or destructive cleanup.
