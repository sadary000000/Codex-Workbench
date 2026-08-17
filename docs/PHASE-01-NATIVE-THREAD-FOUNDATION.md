# PHASE-01：Native Thread Foundation

日期：2026-08-17  
项目：`D:\办公\AI\Codex_Workbench_V1`  
状态：完成 Phase 0 + Phase 1，等待确认，不自动进入下一阶段。

## 1. 实际创建的工程结构

```text
Codex_Workbench_V1/
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ tsconfig.tests.json
├─ README.md
├─ scripts/
│  ├─ build.mjs
│  └─ real-app-server-smoke.ts
├─ src/
│  ├─ main/main.ts
│  ├─ preload/preload.cts
│  ├─ renderer/index.html
│  ├─ renderer/renderer.ts
│  ├─ codex/
│  │  ├─ app-server-client.ts
│  │  ├─ app-server-capabilities.ts
│  │  ├─ codex-command.ts
│  │  ├─ codex-process-environment.ts
│  │  └─ native-thread-runtime.ts
│  └─ shared/
│     ├─ error-info.ts
│     ├─ logger.ts
│     ├─ runtime-types.ts
│     └─ thread-state-store.ts
├─ tests/
│  ├─ app-server-client.test.ts
│  ├─ native-thread-runtime.test.ts
│  └─ fixtures/fake-app-server.mjs
└─ docs/PHASE-01-NATIVE-THREAD-FOUNDATION.md
```

## 2. 从旧 Workbench 移植的内容

旧项目只读审计了以下 donor：

- `src/codex/app-server-client.ts`
- `src/codex/app-server-session.ts`
- `src/codex/app-server-capabilities.ts`
- `src/codex/codex-command.ts`
- `src/codex/codex-process-environment.ts`
- M1/M2/M4A App Server contract tests

新项目没有整块复制旧 Session，也没有复制 Main、Conversation、Transcript、Workflow 或 TaskController。

保留的成熟设计思想：

- stdio JSON-RPC 子进程生命周期；
- request/response pending 表和超时；
- notification waiter；
- stderr、parse error、process exit 分层；
- server request fail-closed；
- native identity 回读校验；
- 断线和重启后用 Thread ID resume；
- 子进程代理环境规范化。

## 3. 重新实现部分与原因

重新实现了最小 `NativeThreadRuntime`，原因是旧 `AppServerSession` 还携带了：

- Workbench Task 语义；
- Workflow 绑定；
- Main Conversation runtime binding；
- ChangeSet / Project 安全链路；
- 旧 UI 事件投影。

新 Runtime 只接受：

```text
cwd
stateFile
nativeThreadId
App Server client
Native notifications
```

没有引入第二套 Conversation、Transcript、Task、Agent State 或 Context State。

## 4. Native Runtime 当前架构

```text
Renderer 调试 UI
→ Preload typed IPC
→ Main NativeThreadRuntime
→ AppServerProcessClient
→ codex app-server --stdio
→ JSON-RPC response / notification / server request
```

Main 只做 IPC 边界、Runtime 生命周期、错误序列化和日志；Native Thread 的事实来自 App Server。

## 5. nativeThreadId 管理

唯一核心身份是：

```text
nativeThreadId
```

本地只保存一个最小绑定文件：

```json
{
  "version": 1,
  "nativeThreadId": "...",
  "cwd": "...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

`localRunId` 只用于一次 Turn 的 IPC correlation、取消和诊断，不是产品 Task。

以下情况会 fail closed：

- 持久化绑定损坏；
- cwd 不一致；
- `thread/resume` 返回不同 ID；
- `thread/read` 返回不同 ID；
- 用户显式 resume ID 与本地绑定冲突。

不会在这些情况下静默创建或替换 Thread。

## 6. App Server lifecycle

已实现：

1. 启动 `codex app-server --stdio`；
2. `initialize`；
3. `initialized` notification；
4. 无绑定时 `thread/start`；
5. 有绑定时 `thread/resume`；
6. `thread/read`；
7. `turn/start`；
8. Native notification 事件输出；
9. `turn/interrupt`；
10. `turn/completed` 等待；
11. 关闭 App Server 子进程但不删除 Thread；
12. 新进程再次按 nativeThreadId resume。

Active Turn 重启目前不会伪造继续结果，而是进入 `ACTIVE_TURN_RECOVERY_REQUIRED`，这是 Phase 1 的安全边界。

## 7. 已实现协议能力

| 能力 | 状态 |
|---|---|
| JSON-RPC request/response | 已实现并测试 |
| notifications | 已实现并测试 |
| server requests | 已实现 fail-closed 响应能力 |
| initialize | 已实现并真实验证 |
| thread/start | 已实现并真实验证 |
| thread/read | 已实现并真实验证 |
| thread/resume | 已实现并真实验证 |
| turn/start | 已实现并真实验证 |
| turn/interrupt | 已实现并真实验证 |
| Native Turn/Item 输出 | 已实现并真实观察 |
| process exit | 已区分并测试 |
| invalid JSON | 已区分并测试 |
| disconnect / reconnect UI | 尚未做正式 UI；重启 resume 已验证 |
| Approval UI | 尚未实现；协议请求 Phase 1 fail-closed |
| Map | 尚未实现 |

## 8. 测试结果

静态与单元测试：

```text
npm run check  PASS
npm test       5 passed / 0 failed
npm run build  BUILD PASS
npm audit --omit=dev  0 vulnerabilities
```

真实 App Server：

- Codex CLI：`0.147.0`；
- 首次真实 `thread/start` 成功；
- 获得真实 `nativeThreadId`；
- 收到 `thread/started`、`turn/started`、`item/started`、`item/agentMessage/delta`、`item/completed`、`turn/completed`；
- 新进程按相同 ID `thread/resume` 成功；
- 恢复后继续第二个 Turn 成功；
- 真实 `turn/interrupt` 成功，Turn 状态为 `interrupted`；
- `thread/read` 能读到全部已完成/中断 Turn；
- Electron `npm run dev` 已启动并打印 `app_ready`。

## 9. 已知风险

- 当前调试 UI 直接显示 bounded Native notification，尚不是正式 Codex Thread Workspace；
- server request 目前默认拒绝，没有 Approval Card；
- Active Turn 跨进程恢复尚未定义安全语义；
- 当前只持久化一个本地 Thread binding，尚无多 Project / 多 Thread 投影；
- App Server 协议仍依赖本机 Codex CLI 版本；
- 真实 smoke 产生的 Codex Native Thread 属于本机 Codex 会话记录，Workbench 没有删除它；
- 真实 smoke 的本地绑定位于被 `.gitignore` 忽略的 `.real-smoke/`。

## 10. 下一阶段建议

等待用户确认后再进入 Phase 2。下一阶段优先级应是：

1. 明确正式 Native Thread Workspace 的事件投影契约；
2. 明确多 Thread / Project 的最小本地投影，而不是恢复旧 Conversation；
3. 设计 Approval / server-request 的安全闭环；
4. 设计 disconnect / active Turn recovery 状态；
5. 之后才开始正式 Codex 风格导航和 Workspace UI。

本阶段没有实现 Map、Workflow、Review、Prompt 工具、Git 工作台或 Legacy Conversation 迁移。
