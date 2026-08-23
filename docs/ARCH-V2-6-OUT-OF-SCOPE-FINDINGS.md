# ARCH-V2-6 Out-of-scope Findings

The following were observed by the independent audits and deliberately not silently expanded into this round:

1. Full removal/migration of historical `chatUrl`/`targetChatUrl` fields from paused Requirement/Planner/External Action compatibility code.
2. Complete separation of normal Automation persistence initialization from stage-review harness composition.
3. Independent stage user-data/profile/Journal isolation for future real AUT gates.
4. Full immutable PolicyVersion injection across every legacy compatibility caller.
5. Reviewer production capability or any Automation workflow implementation.

These are review items, not accepted as fixed.
