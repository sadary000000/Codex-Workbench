# WEB-6.4：WebGPT 全局操作仲裁与单浏览器租约

## 1. Scope Resolution

```yaml
stage: WEB-6.4
official_name: WebGPT 全局操作仲裁与单浏览器租约
goal: 让所有会改变 WebGPT 页面上下文的自动操作共享一个 capacity=1 的浏览器资源仲裁器
in_scope:
  - Operation identity and bounded diagnostics
  - Global Browser Lease with capacity=1
  - FIFO queue and recovery priority
  - Request lifecycle lease from target preparation through terminal/recovery state
  - Project/Role/navigation serialization
  - USER_CONTROL / AUTO_CONTROL arbitration
  - Network candidate binding to the active operation
  - Restart-safe recovery ordering
  - CLI status diagnostics and packaged smoke evidence
out_of_scope:
  - WEB-6.5 or Automation architecture
  - New BrowserView/WebContentsView instances
  - V1 Native Thread/Turn/Item changes
  - New Conversation/Transcript/Task truth
  - Multi-session or multi-browser support
  - Real Prompt in the final smoke
architecture_boundary: WebGPT feature/runtime only; V1 Frozen Core remains unchanged
gate: contract/unit regression plus latest packaged EXE multi-CLI and USER_CONTROL smoke
```

WEB-6.3 的网络事件仍然只是 completion candidate。Page Probe / Request Manager 的终态判断仍是最终事实；本阶段没有把网络事件升级为完成事实。

## 2. Design

Workbench 当前只创建一个 WebGPT `WebContentsView`。新增 `WebGptOperationArbiter` 作为该资源的统一仲裁层：

```text
GUI / CLI / INTERNAL
          |
          v
WebGptOperationArbiter (capacity = 1)
          |
          v
唯一 WebContentsView
```

每个自动操作具有独立的 `operationId`，并保留来源、owner/requester、requestId、Project、Role、目标 Chat、操作类型和时间线。它不复用 `nativeThreadId`、`requestId` 或 `idempotencyKey` 充当浏览器资源身份。

资源模式为：

```text
FREE -> LEASED_AUTO -> FREE
  |         |
  |         +-> STALE / RELEASED / RECOVERY_REQUIRED
  +-> USER_CONTROL
  +-> DEGRADED
```

普通自动操作使用 FIFO；恢复操作优先于新的导航；同一 lease 的重复释放和过期 lease 释放均为安全 no-op。队列为内存态，不在重启时恢复。持久化的 Request Journal 仍然是请求恢复事实源，重启后先 reconcile 未完成请求，再允许新的自动导航。

`STATUS`、`SCREENSHOT`、`CURRENT` 等只读操作通过 bounded read path 记录有限诊断；会改变页面上下文的 `OPEN_CHAT`、`PROJECT_OPEN`、`PROJECT_NEW_CHAT`、`ROLE_OPEN`、`SEND`、`RECOVERY` 等操作必须取得自动 lease。截图诊断不包含页面正文、Prompt、回答、Cookie 或 Token。

## 3. Request / Navigation / Role 接入

### Request lifecycle

SEND lease 覆盖完整后台生命周期，而不是只覆盖 `submit()`：

```text
target validation
  -> open/reconcile target Chat
  -> Composer validation
  -> Prompt submit
  -> GENERATING / network candidate
  -> Page Probe confirmation
  -> COMPLETED / FAILED / RECOVERY_REQUIRED
  -> lease release
```

CLI `wait` 超时只表示客户端等待超时，不会释放仍在生成中的 SEND lease。只有 Request Manager 进入终态或明确的恢复交接态，lease 才会释放。

### Navigation and Project/Role

Project open/new-chat、Chat open、Role open/new 和发送目标准备统一进入同一 arbiter。Role bound send 不再先在租约外单独打开 Chat，而是在 Request Manager 的 SEND lease 内完成目标校验和发送，避免中间被另一个操作改变当前页面。

### USER_CONTROL

`webgpt control user` 是高优先级控制信号：停止新自动操作，抢占/失效当前自动上下文，并让自动队列保持等待。用户控制期间新的自动 Project/Chat 操作 fail-closed，返回 `WEBGPT_USER_CONTROL`；`control auto` 先执行待恢复请求的 reconcile，再恢复队列。旧网络 candidate 在接管、导航和操作终止时失效，不能作用于新的 operation。

### Diagnostics

`webgpt status --json` 暴露有限资源状态：

```json
{
  "browserResource": {
    "capacity": 1,
    "mode": "FREE|LEASED_AUTO|USER_CONTROL|DEGRADED",
    "activeOperationId": "…",
    "activeRequester": "CLI|INTERNAL",
    "activeRequestId": "…",
    "queueDepth": 0
  }
}
```

诊断保留操作类型、owner 和时间，不携带 Prompt、回答正文、认证材料或私人网页内容。

## 4. Changed Files

产品 / runtime：

- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts`
- `src/features/webgpt/runtime/webgpt-workspace.ts`
- `src/features/webgpt/runtime/webgpt-request-manager.ts`
- `src/features/webgpt/runtime/webgpt-role-session-service.ts`
- `src/features/webgpt/network/network-observer.ts`
- `src/features/webgpt/network/network-types.ts`
- `src/features/webgpt/types.ts`
- `src/main/main.ts`
- `package.json`

测试 / smoke：

- `tests/webgpt-operation-arbiter.test.ts`
- `tests/webgpt-network-observer.test.ts`
- `tests/webgpt-request-manager.test.ts`
- `tests/webgpt-role-session-service.test.ts`
- `scripts/real-webgpt-web6.4-arbiter-smoke.ts`

本阶段没有修改 `src/codex/**`、Native Thread/Turn/Item 事实源、RuntimeRegistry、Map 规则或 Renderer Native Composer 语义。

## 5. Verification Summary

确定性测试覆盖：

- capacity=1、FIFO、double release、stale lease；
- recovery priority；
- USER_CONTROL 抢占、队列保持与 AUTO_CONTROL 恢复；
- SEND lease 在 wait timeout 后仍保持；
- Network Observer 的 operationId 绑定和旧候选失效；
- Project/Role/Request Manager 回归；
- WEB-5 幂等、恢复、no-resend 和 V1 Frozen Core 回归。

最终执行结果：

```text
npm run check         PASS
npm test              PASS (177/177)
npm run build         PASS
npm audit --omit=dev  PASS (0 vulnerabilities)
npm run package:win   PASS
git diff --check      PASS (无 diff 错误)
```

## 6. Real Packaged Smoke

使用最新打包 EXE，通过 Node `execFile` 调用 CLI；测试只启动一个由 harness 自己拥有的 EXE，未发送真实 Prompt：

```yaml
result: PASS
run_id: web6.4-arbiter-1787251095064-654f7973
project: workts
concurrent_cli_count: 2
real_prompt_count: 0
max_real_prompts: 1
capacity_observed: true
user_control_blocked_auto: true
user_control_error: WEBGPT_USER_CONTROL
rate_limit_observed: false
global_new_chat_clicked: false
```

两个并发 `project open --name workts` 的 operation 起止时间没有重叠，且两个 operationId 不同，证明最新 packaged EXE 的页面操作未并发占用同一个浏览器资源。该 smoke 的返回结果是在操作完成后采样，因此没有把 `queueDepth=0` 误报为实时 active queue；真正的队列顺序和抢占语义由确定性单元测试覆盖。

USER_CONTROL 期间再次发起 Project open 被明确拒绝；AUTO_CONTROL 后先执行 recovery reconcile，再恢复为可用状态。Smoke evidence 已脱敏，字段明确记录 `promptBodyLogged=false`、`responseBodyLogged=false`、`cookiesRead=false`、`tokensRead=false`。

## 7. Known Limitations

- 本阶段没有做真实 SEND/GENERATING Gate，真实新 Prompt 数为 0；完整发送生命周期由 contract/unit 测试覆盖，避免触发网页限流。
- 没有人为制造 App Server hard crash、双客户端 writer conflict 或稳定 no-rollout；已有 WEB-5/Stage A contract 与 recovery 测试继续作为回归证据。
- Real smoke 使用显式预启动的最新 packaged EXE，再通过 `execFile` 调 CLI，以隔离控制面启动方式和本阶段仲裁证据。
- 未实现 Browser Pane、Automation、Planner、Reviewer、多账号或多浏览器。

## 8. Boundary

本阶段完成后停止在 WEB-6.4，等待 GPT 审查；不得自动进入 WEB-6.5 或 Automation 架构设计。
