# WEB-6.4 Arbiter Real Smoke — ARCH-V2-4 FIX ROUND 3

## Execution boundary

```yaml
package: D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-4-round-3\package\Codex Workbench V1.exe
user_data: unique OS temporary directory per run
business_project: not required by this lease/control smoke
maxRealPrompts: 0
promptBodyLogged: false
privatePageContentLogged: false
```

The previous failure used an existing standard descriptor/runtime. This run started an owned packaged Workbench with an isolated `--user-data-dir=<path>`, waited for its descriptor, and verified the owned process remained alive. The user’s running Workbench was not killed or reused.

## Command sequence

```text
webgpt control user --json
webgpt control auto --json
webgpt open --json
webgpt control auto --json
webgpt open --json       (two concurrent invocations)
webgpt control user --json
webgpt open --json       (must be USER_CONTROL)
webgpt control auto --json
webgpt status --json
```

## Observed result

```yaml
result: PASS
startup_userDataIsolated: true
descriptorReady: true
ownedWorkbenchExit: null during smoke
capacityObserved: true
capacity: 1
concurrent_open_ok_count: 1
concurrent_open_user_control_count: 1
user_control_blocked_auto: true
user_control_error_code: USER_CONTROL
final_browser_mode: FREE
final_queue_depth: 0
last_operation_state: RELEASED
rateLimitObserved: false
realPromptCount: 0
globalNewChatClicked: false
```

The isolated browser may spend time navigating its initial blank page; this is not used as a success criterion. Success is based on the Control Plane/Arbiter response and final lease evidence.

## Safety

The evidence JSON contains bounded command metadata, error codes, operation identity and resource state only. It does not contain cookies, tokens, passwords, browser profile data, prompt bodies, response bodies or private page content.
