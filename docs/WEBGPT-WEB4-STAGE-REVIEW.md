# Codex Workbench WebGPT — WEB-4 Stage Review

## Executive Summary

- Stage: **WEB-4 — Role Session Registry & Routing**
- Base commit: `a5adc693459da1a990728851aab12680b9b9404c`
- Implementation commit: `5d22196` (`feat: implement webgpt role session routing`)
- Local result: `PASS_WITH_ISSUES_CANDIDATE`
- Scope result: Project-scoped Requirement / Planner / Reviewer role binding, opening, routing, persistence, CLI and lightweight GUI projection are implemented.
- `v1_core_behavior_changed: NO`
- No Automation layer, workflow layer, multi-account, multi-session, multi-browser, attachment or prompt orchestration was added.

## Scope Resolution

The WEB-4 user execution prompt defines the only scope for this change:

```text
Project + Role → real ChatGPT Chat URL
```

The Workbench continues to own one WebGPT Browser Runtime, one Electron Session, one Page Adapter and one Request Manager. The Role Registry is a bounded reference index and is not a second conversation, transcript, task or response store.

## Architecture

```text
Workbench Project identity
        ↓
WebGptRoleSessionService
        ↓
WebGptRoleSessionRegistry
        ↓
one WebGptWorkspace / Browser Runtime / Electron Session
        ↓
one WebGptRequestManager
```

The registry is persisted under the existing WebGPT feature user-data boundary:

```text
<userData>/webgpt/roles/role-sessions.json
```

It stores only `projectId`, role, Chat URL, optional title, status and timestamps. It does not store cookies, tokens, passwords, prompts, responses or transcript content.

## Registry Contract

Roles:

- `REQUIREMENT`
- `PLANNER`
- `REVIEWER`

Statuses:

- `UNBOUND`
- `BOUND`
- `PENDING_CHAT_URL`
- `INVALID`

Important behavior:

- A new Chat may first be `PENDING_CHAT_URL` at `https://chatgpt.com/`; the first successful send binds the observed real `/c/<id>` URL.
- Chat URLs are strictly limited to HTTPS `chatgpt.com` / `www.chatgpt.com` Chat paths.
- A bound URL cannot be reused by another Project/Role.
- Existing bindings are not overwritten without explicit `--replace`.
- Invalid or unbound roles fail closed; there is no current-Chat fallback and no replacement Chat creation.
- Project lookup uses the existing Workbench `projectId` and persistence store.

## CLI Contract

Implemented through the existing WEB-2/WEB-3 Control Plane:

```text
webgpt role list   --project <project-id> --json
webgpt role status --project <project-id> --role <role> --json
webgpt role new    --project <project-id> --role <role> [--replace] --json
webgpt role bind   --project <project-id> --role <role> --url <chat-url> [--replace] --json
webgpt role open   --project <project-id> --role <role> --json
webgpt send        --project <project-id> --role <role> --text/--file <input> --json
```

`project` and `role` are a required pair for role-aware send. `wait` and `result` retain non-sensitive `projectId`, `role` and target URL metadata. Control ownership remains `AUTO_CONTROL`, `USER_CONTROL` or `PAUSED`; role commands do not secretly operate the page under `USER_CONTROL`.

## Real Role Isolation Evidence

Command:

```text
npm run test:real:webgpt:roles
```

Result: `REAL_WEBGPT_ROLE_SMOKE_PASS`, with `restart: true`.

Observed:

- Requirement, Planner and Reviewer each produced a distinct real `https://chatgpt.com/c/<id>` URL.
- Each binding remained associated with its own role and the same Workbench Project.
- Each role returned its own role-specific `*_OK` response.
- The three requests shared one `workbenchInstanceId` and one `webgptRuntimeId` for the run.
- After the Workbench process was stopped and restarted, `role list`, `role status` and `role open` restored the same three bindings.
- The exact Chat identifiers are intentionally not copied into this report; they remain in the local smoke output and user WebGPT session state.

## Restart Persistence

The packaged EXE was used for the real role smoke. The test created the three bindings, stopped the owned Workbench process, started the same packaged EXE again, then checked/listed/opened every role. The result retained the original role-to-Chat mapping and the same project identity; no replacement role, Browser Runtime or Chat was created during reopen.

## GUI / CLI Same Runtime

The existing WEB-3 baseline established that GUI and CLI use the same WebGPT Runtime. The current WEB-4 smoke additionally confirmed one Workbench/runtime identity across all three role requests and after restart. A fresh GUI click-through was not independently completed in this run because the Windows Computer Use helper could not obtain click geometry for the packaged Chromium window (`SetIsBorderRequired` / `coordinate input geometry is unavailable`). This is an observation-tool limitation, not a product success claim; the GUI role strip and IPC contract are covered by renderer/preload contract tests, while the CLI/runtime path is covered by the real smoke.

## Failure Matrix

Automated contract/unit coverage includes:

- unknown Project;
- unsupported Role;
- unbound Role (`ROLE_UNBOUND`);
- invalid/non-ChatGPT URL;
- same Chat collision across Project/Role;
- repeated bind without explicit replacement;
- `USER_CONTROL` role open/new/send protection;
- pending Chat URL before first `/c/<id>`;
- invalid/remote-missing role binding;
- no fallback to the currently visible Chat;
- request metadata and target-URL mismatch protection;
- registry persistence and safe metadata boundary.

An additional real issue was found during the first packaged restart smoke: the newly loaded page exposed a Composer before its state had stabilized, causing `COMPOSER_DRAFT_MISMATCH`. The minimal fix requires two consecutive stable Composer probes after navigation before automation proceeds. The post-fix packaged restart smoke passed.

## Changed Files

Core implementation:

- `src/features/webgpt/runtime/webgpt-role-session-registry.ts`
- `src/features/webgpt/runtime/webgpt-role-session-service.ts`
- `src/features/webgpt/runtime/webgpt-request-manager.ts`
- `src/features/webgpt/runtime/webgpt-workspace.ts`
- `src/features/webgpt/types.ts`
- `src/features/webgpt/index.ts`
- `src/main/webgpt-command.ts`
- `src/main/webgpt-control.ts`
- `src/main/main.ts`
- `src/preload/preload.cts`
- `src/renderer/index.html`
- `src/renderer/renderer.ts`
- `package.json`

Tests and smoke:

- `tests/webgpt-role-session-registry.test.ts`
- `tests/webgpt-role-session-service.test.ts`
- `tests/webgpt-request-manager.test.ts`
- `tests/webgpt-command.test.ts`
- `tests/webgpt-control-contract.test.ts`
- `tests/webgpt-feature-contract.test.ts`
- `scripts/real-webgpt-role-smoke.ts`

## Security

- No cookie, password, token or account credential was read, exported or committed.
- No new software, browser plugin, Playwright, Selenium, CDP or system configuration was installed.
- Remote WebGPT content continues to use `contextIsolation: true`, `nodeIntegration: false`, sandboxed WebContentsView and the existing navigation/permission/download restrictions.
- CLI remains a thin authenticated Control Plane client; it does not own DOM, Browser or Session state.
- Role Registry stores references and bounded metadata only.

## Tests and Regression

Automated:

```text
npm run check                         PASS
npm test                              PASS — 149/149
npm run build                         PASS
npm run package:win                   PASS
npm audit --omit=dev                  PASS — 0 vulnerabilities
git diff --check                      PASS (line-ending warnings only)
secret scan                           PASS — no literal credential found
```

Real regression:

```text
npm run test:real                     PASS with isolated fresh state directory
npm run test:real:navigation          PASS
npm run test:real:workspace            PASS
npm run test:real:multi-thread         PASS
npm run test:real:composer-capability PASS
npm run test:real:composer-persistence PASS
npm run test:real:project-lifecycle   PASS
npm run test:real:reliability          PASS
npm run test:real:webgpt:roles         PASS — restart: true
```

The first default `npm run test:real` invocation reused an old `.real-smoke` binding and correctly returned `no rollout found`. It was then rerun with a fresh temporary state directory and cleanup enabled; that run created a fresh Native Thread, completed `NATIVE_THREAD_SMOKE_OK`, read the same thread and deleted only that smoke-created thread. The stale fixture was not changed or silently repaired.

## Package Provenance

Latest packaged application:

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
```

SHA256:

```text
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```

## V1 Core Integrity

```text
Native Thread / Turn / Item identity: preserved
RuntimeRegistry and multi-thread isolation: preserved
Project identity and ownership: preserved
Composer capability/persistence: preserved
Conversation Map: untouched
Manual USER_CONTROL path: preserved
v1_core_behavior_changed: NO
```

## Known Issues / Deferred

- Multi-account, multi-session and multi-browser remain deferred.
- Attachment upload remains deferred/unsupported.
- No Automation workflow or role prompt orchestration was introduced.
- The Windows Computer Use helper could not provide a fresh GUI click geometry observation for this run; GUI role projection remains contract-tested and the WEB-3 same-runtime baseline remains the applicable GUI/CLI evidence.
- A default old `.real-smoke` state directory can contain a stale Native Thread binding; fresh isolated state is required for a clean generic smoke. The product’s existing missing-rollout handling remains fail-closed.

## Local Files and Legacy Status

- `V1docs.zip`: absent; no local copy was added.
- `dist-stage-a/`: present before this stage and left untouched/uncommitted.
- `指导文档/*.docx`: present before this stage and left untouched/uncommitted.
- Old donor `D:\办公\AI\Codex_Workbench`: read-only inspection only; its pre-existing dirty baseline was preserved.
- `D:\办公\AI\Auto_Agent`: read-only status was clean; not modified.
- No cookies, tokens, passwords or account data are included in this report or package.

## Subagents

Both explicitly requested parallel audits completed naturally before integration:

1. `Pasteur` (`01a01cb8-cb10-75d2-9bc1-d3fa37a69608`): read-only architecture audit. Result adopted: one existing WebGPT Runtime/Session/RequestManager with a Project-scoped Role Registry, strict URL and no fallback.
2. `Sartre` (`01a01cb8-d0ab-7c30-a4b7-800caa33d034`): read-only testing/security audit. Result adopted: strict URL/collision checks, USER_CONTROL protection, metadata-only persistence and the need for real role smoke.

Both results were reviewed and incorporated. No subagent remained running at package time.

## Gate

```text
role_registry: PASS
project_scoped_role_binding: PASS
role_isolation: PASS
role_cli_contract: PASS
role_aware_send: PASS
restart_persistence: PASS
gui_cli_same_chat: PASS_WITH_BASELINE_AND_TOOL_LIMITATION
single_webgpt_runtime: PASS
control_ownership: PASS
v1_core_behavior_changed: NO
targeted_v1_regression: PASS
legacy_default_smoke_fixture: KNOWN_STALE_BINDING (isolated rerun PASS)
gate: READY_FOR_GPT_REVIEW
```
