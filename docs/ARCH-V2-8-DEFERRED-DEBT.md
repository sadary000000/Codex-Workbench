# ARCH-V2-8 Deferred Debt

## Existing non-blocking debt carried from V2-7

These are documented P2 / future hardening items and are not silently presented as implemented:

1. No complete production-facing projection rebuild command; isolated delete/rebuild evidence exists.
2. No user-facing migration CLI; explicit migration services and tests exist.
3. Low-level SQLite persistence API remains available to migration/tests; production composition uses AutomationStore.
4. Multi-account/session management, Planner, Reviewer and workflow scheduling are outside the frozen V1/V2 boundary.
5. Exactly-once delivery to an external provider is not claimed; the safety contract is no-blind-resend plus persisted correlation/reattach.
6. Browser profile, Cookie, Token and private ChatGPT content are never copied into review artifacts.

## Not classified as deferred debt

The following are active Gate evidence and require GPT review:

- actual App Server 0.148.0-alpha.9 versus verified allowlist 0.147.0;
- packaged official CLI status TIMEOUT.

They are not marked accepted limitation and are not fixed opportunistically in this confirmation stage.
