# PHASE-02：Identity / Persistence / Reliability Foundation

日期：2026-08-17
项目：`D:\办公\AI\Codex_Workbench_V1`
状态：Phase 2 完成，等待 GPT 审查；不自动进入 Codex-shaped UI 阶段。

## 1. 最终 identity model

唯一 Native Thread 核心身份仍然是：

```text
nativeThreadId
```

事实来源保持：

```text
Native Thread → Native Turn → Native Item
```

Workbench 只保存两类薄数据：

1. `native-thread-binding.json`：当前 Runtime 的 active Native Thread 选择，兼容 Phase 1 的恢复路径；
2. `workbench-state.json`：Project、ThreadProjection 和 Prompt Recovery 的版本化本地投影。

任何 `thread/resume`、`thread/read` 返回的 ID 都会与期望的 `nativeThreadId` 比较。失败时只报告错误，不自动创建或替换 Thread。

显式 `resume(nativeThreadId)` 是用户选择另一个已知或明确指定 Native Thread 的操作；只有在 resume/read 和投影校验成功后，才会更新 active binding。

## 2. persistence schema

`workbench-state.json` 使用版本字段：

```json
{
  "version": 1,
  "updatedAt": "2026-08-17T00:00:00.000Z",
  "projects": [],
  "threads": [],
  "prompts": []
}
```

Project：

```text
projectId
name
cwd
createdAt
updatedAt
metadata
```

ThreadProjection：

```text
nativeThreadId
projectId | null
cwd
pinned
title
createdAt
updatedAt
lastKnownState
lastKnownTurnId
lastError
```

PromptRecovery：

```text
localRunId
nativeThreadId
turnId | null
prompt
status: pending | running | failed | recovery_required | interrupted
createdAt
updatedAt
lastError
```

Prompt 文本只在 pending/running/失败恢复记录中保存，不作为消息历史或 Transcript 真相源；成功或正常 interrupted Turn 完成后会清除。

实现文件：

- `src/shared/persistence-store.ts`
- `src/shared/runtime-types.ts`
- `src/shared/thread-state-store.ts`

## 3. Project / Thread relationship

数据层支持：

```text
Project 0..N ThreadProjection
Standalone Thread：projectId = null
```

已提供的数据/API 边界：

- `createProject`
- `listProjects`
- `listThreads(projectId?)`
- `ensureThreadProjection`
- `bindThreadToProject(nativeThreadId, projectId | null)`
- `getThreadProjection`

Electron Main/Preload 已暴露对应 persistence IPC，但本阶段没有制作正式左侧导航或 Project UI。

Project `cwd` 作为稳定路径关系参与校验；Project ID 由本地 UUID 生成，不依赖 UI 文本作为唯一身份。同一 cwd 不会静默产生第二个 Project。

## 4. Standalone Thread model

没有 Project 绑定的 Native Thread 会创建：

```json
{
  "nativeThreadId": "...",
  "projectId": null,
  "cwd": "..."
}
```

Standalone Thread 仍然可以被显式绑定到已有 Project；绑定是独立的数据操作，不会改变 Native Thread，也不会复制 Native 历史。

## 5. localRunId 语义

`localRunId` 只用于：

- Renderer ↔ Main IPC correlation；
- 当前 Turn 的 Prompt Recovery 记录；
- interrupt/cancel 诊断；
- 日志和错误关联。

它不是 Task、Conversation、Transcript，也没有形成 Task list、Task hierarchy 或产品级 Task lifecycle。

## 6. Prompt lifecycle

发送顺序现在是：

```text
生成 localRunId
→ 持久化 Prompt status=pending
→ 调用 turn/start
→ 获得 turnId 后更新 status=running
→ 等待 turn/completed
→ completed/interrupted：清除 recovery 记录
→ failed：保留 Prompt 和错误
→ timeout/process exit/connection lost/关闭：status=recovery_required
```

持久化 Store 对同一文件的 mutation 使用串行队列。这样 Prompt 写入与 Runtime 关闭、断线投影写入不会互相覆盖；每次落盘仍采用临时文件写入后 atomic rename。

关键行为：

- `APP_SERVER_TIMEOUT` 不会自动重试，Prompt 保留并标记 recovery；
- `APP_SERVER_PROCESS_EXIT` 保留 Prompt、记录 exitCode/stderr，并将 ThreadProjection 标为 disconnected；
- Native Turn 返回 failed 状态时返回 `TurnResult.error`，同时保留失败 Prompt；
- interrupt 成功后 ThreadProjection 仍为 ready，Native Thread 不会被删除；
- 关闭时存在 pending/running Turn，会标记 recovery_required。

## 7. restart / crash recovery

已实现并测试：

1. 正常完成 Thread：按原 `nativeThreadId` resume，Projection 进入 ready；
2. interrupted Thread：可以继续 resume，已中断 Turn 保留在 Native `thread/read`；
3. Runtime 关闭时存在 active/pending Turn：Prompt 保留为 recovery_required；
4. App Server process exit：Runtime 进入 disconnected，Projection 保存错误信息；
5. 下一次启动发现 Native Thread 仍有 active Turn：进入 `RECOVERY_REQUIRED`，不伪造续接结果；
6. active binding 缺失但仍有 ThreadProjection：返回 `THREAD_BINDING_MISSING`，不创建新 Thread；
7. 持久化 JSON 损坏、schema 版本不支持或 identity relation 无效：拒绝读取和写入，不静默清空；
8. 显式 resume 另一个 Thread：验证成功后才更新 active binding。

当前安全策略是：

```text
detect → report → resume/read 或显式用户操作
```

Active Turn 跨进程的自动继续仍未定义，Workbench 不会伪造上下文或重复发送 Prompt。

## 8. 错误分类

App Server 层继续区分：

```text
APP_SERVER_TIMEOUT
APP_SERVER_PROCESS_EXIT
APP_SERVER_PROCESS_ERROR
APP_SERVER_SPAWN_FAILED
APP_SERVER_PROTOCOL_PARSE_ERROR
APP_SERVER_PROTOCOL_REJECTED
APP_SERVER_CONNECTION_LOST
APP_SERVER_CLIENT_CLOSED
```

Runtime/identity 层包括：

```text
THREAD_ID_MISMATCH
THREAD_ID_CONFLICT
THREAD_BINDING_INVALID
THREAD_BINDING_MISSING
THREAD_CWD_MISMATCH
ACTIVE_TURN_RECOVERY_REQUIRED
TURN_FAILED
TURN_STATUS_UNKNOWN
```

Persistence 层包括：

```text
PERSISTENCE_CORRUPT
PERSISTENCE_INVALID
PERSISTENCE_VERSION_UNSUPPORTED
PERSISTENCE_WRITE_FAILED
PROJECT_CWD_CONFLICT
THREAD_PROJECT_CONFLICT
PROMPT_INVALID
```

错误对象保留 `code`、`message`、`exitCode`、`stderr` 和必要的 cause；IPC 只做序列化，不吞掉原始错误。

## 9. 从旧 Workbench 参考或移植了什么

旧项目 `D:\办公\AI\Codex_Workbench` 仍只读审计，未修改。参考的是：

- atomic JSON persistence 的写入思路；
- path/cwd 关系校验；
- App Server process/parse/stderr 错误分层；
- diagnostics 和 recovery 状态表达。

没有移植：

- Conversation source of truth；
- Transcript source of truth；
- Task 产品模型；
- Workflow / Review；
- Legacy Exec identity；
- 旧 Main 的全局状态投影。

Phase 2 新增的持久化模块没有依赖旧项目代码。

## 10. 自动测试结果

静态与单元门禁：

```text
npm run check  PASS
npm test       16 passed / 0 failed
npm run build  PASS
npm audit --omit=dev  0 vulnerabilities
```

新增覆盖：

- Project persistence；
- 一个 Project 关联多个 ThreadProjection；
- Standalone Thread；
- 显式 Project binding；
- duplicate/cwd/Project identity conflict；
- versioned schema；
- corrupted/unsupported state fail-closed；
- atomic mutation 前的有效状态保留；
- Prompt pending/running/failed/recovery；
- timeout/process exit 的 Prompt Recovery；
- Runtime close 后的 active Prompt recovery；
- active Turn restart 不伪造续接；
- interrupt 不删除 Thread；
- binding 缺失时不创建替代 Thread。

真实 App Server：

- 真实已有 Native Thread resume 成功；
- Phase 2 `workbench-state.json` 成功生成/更新 ThreadProjection；
- 真实 Turn 完成，`thread/read` 成功；
- 真实 interrupt 返回 `status: interrupted`；
- interrupt 后 Projection 仍为 `lastKnownState: ready`；
- `nativeThreadId` 在 binding、Native response、Projection 三处一致。

## 11. 已知限制

- 当前只有一个 Main Runtime active slot；数据层已支持多个 ThreadProjection，但正式多 Thread 切换 UI 留到后续阶段；
- persistence mutation queue 是单进程 Store 内串行化，不是跨多个 Workbench 进程的分布式锁；
- 损坏文件会 fail closed 并保留原文件，目前没有自动 quarantine/backup UI；
- Active Turn 跨进程只检测并报告，不自动决定是否继续；
- server request 仍然 fail-closed，没有 Approval UI；
- 当前仍是调试 UI，不是正式 Codex Thread Workspace；
- 没有实现左侧 Pinned / Projects / Recent、Map、Workflow、Review、Git 工作台或 Legacy Conversation migration。

## 12. 下一阶段建议

等待 GPT 审查后再决定下一阶段。若审查通过，建议先做：

1. 基于已有 Project/ThreadProjection API 设计正式左侧导航数据契约；
2. 定义多 Thread active slot 与 Thread Workspace 的最小切换语义；
3. 设计 server-request Approval 的安全闭环；
4. 再进入 Codex Desktop 风格 UI。

本报告完成后停止，不自动实现上述下一阶段。
