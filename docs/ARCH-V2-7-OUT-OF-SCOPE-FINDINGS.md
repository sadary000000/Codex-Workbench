# ARCH-V2-7 Out-of-scope Findings

- No full production projection rebuild command was added; only the isolated delete/rebuild gate was added.
- Exactly-once delivery to an external provider is not claimed; the contract is no-blind-resend plus persisted correlation/reattach.
- The low-level `SqliteAutomationPersistence` class remains available to migration/tests; production composition now uses `AutomationStore`.
- No user-facing migration CLI was added.
- Multi-account/session management, Automation, Planner, Reviewer and workflow scheduling remain outside this stage.
- No real WebGPT Prompt, new business Chat, browser profile, cookie, token or private ChatGPT API was used.
