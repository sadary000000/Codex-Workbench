# STAGE-K0 Deferred Debt

These items are deliberately not implemented in K0 and are not blockers for
the K0 foundation contract when the current fail-closed boundaries hold.

| item | disposition |
|---|---|
| Planner / Executor / Reviewer / Scheduler | deferred; K0 must not create these components |
| AUT-2 / AUT-3 orchestration | deferred; no stage transition is implied by K0 |
| multi-project automation scheduling | deferred |
| full external review-submit hardening | deferred to the Submission Runner scope; no K0 change |
| browser/session UI work | deferred; no browser or WebGPT UI implementation |
| raw Requirement content storage | intentionally not added; opaque InputRef/content ownership remains authoritative |
| accepted provider side-effect after unresolvable correlation | fail-closed `RECOVERY_REQUIRED`; no blind retry |
| human confirmation UX | deferred; K0 only preserves the domain boundary |
| durable encrypted secret/session storage | deferred and outside K0; no credentials are stored |

No item in this list permits a wrong-thread send, silent identity replacement,
duplicate Prompt, second Conversation truth, or deletion of user files.
