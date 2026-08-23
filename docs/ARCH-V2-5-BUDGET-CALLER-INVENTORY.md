# ARCH-V2-5 Budget Caller Inventory

| Caller / surface | Classification | Policy path | Side effect |
|---|---|---|---|
| webgpt.send -> WebGptRequestManager Prompt | ACTIVE_PRODUCTION | new request pins PolicyVersion; process uses authorizePinned(PROMPT) | submitPrompt |
| webgpt.new-chat | ACTIVE_PRODUCTION | authorize(NEW_CHAT), reserve/commit | createChat |
| project new-chat | ACTIVE_PRODUCTION | authorize(NEW_CHAT), reserve/commit | createChatInProjectForAutomation |
| RequestManager implicit NewChat | ACTIVE_PRODUCTION | exact record pin + authorizePinned(NEW_CHAT) | createChat |
| Requirement repair adapter | PAUSED_NOT_EXECUTABLE / bounded adapter | repair reservation with commit-before-dispatch; real AUT gate is not active | no active production Prompt |
| AUT-2 Requirement gate callers | PAUSED_NOT_EXECUTABLE | exact test/gate env only | no normal production call |
| AUT-3 Planner callers | PAUSED_NOT_EXECUTABLE | exact test/gate env only | no normal production call |
| RequestManager idempotent reattach/reconcile | LEGACY_READ_ONLY | query/recovery evidence only; no blind resend | none |
| status/readLatest/inspect | LEGACY_READ_ONLY | query-only | none |
| webgpt-external-action contract fixtures | TEST_ONLY | local contract/observation tests | fake provider only |
| operation budget / arbiter diagnostics | LEGACY_READ_ONLY | resource evidence, not Budget authority | none |

The only normal-host production WebGPT mutation authority is
WebGptPolicyAuthority backed by the stable persisted WebGPT PolicyVersion. There
is no fallback to latest for an unpinned persisted request.
