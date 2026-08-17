# Phase 4 — Codex Thread Workspace

状态：实现完成，已通过命令行验证，待 GPT 阶段审查。

本阶段把 Phase 3 的 Native Thread 导航接成一个以 Codex App Server 原生对象为事实来源的工作区：`Native Thread → Native Turn → Native Item`。Workbench 只保留必要的视图缓存、Renderer 草稿和 Phase 2 的持久化恢复记录，没有新增 Conversation、Transcript、Task、Agent 或本地消息历史生命周期。

## 实现结果

### 原生读模型与事件层

- `src/shared/thread-read-model.ts` 新增只读 `thread/read` 解析器，保留 Native Thread/Turn/Item 的原生 ID、状态、类型、文本、输入、输出、错误和 `raw` 字段。
- `src/codex/native-thread-runtime.ts` 的 `readThreadInternal` 现在要求 `includeTurns: true`，返回完整 Native Turn/Item 视图；仍先校验返回的 `nativeThreadId`，ID 不匹配即失败，不创建替代 Thread。
- `src/shared/native-event-normalizer.ts` 提供有界的 `Native Event → Visible Event` 适配层，覆盖 User、Assistant、Thinking/Processing、Command/Tool、File、Web/Search、Approval 和 Unknown。未知事件保留为安全的 `unknown`，不猜测为本地生命周期事件。
- Renderer 只使用 `textContent`、有界 JSON 和 DOM 节点渲染原生字段；未知字段可展开查看，不执行原生内容。

### Thread Header 与 Native Turn/Item 工作区

- 中心工作区显示 Native Thread 标识、Project/Standalone 归属、原生 cwd、Runtime 状态和重新读取操作。
- 主滚动区按原生 Turn 顺序展示 User、Assistant、Thinking/Processing、Command/Tool、File Change、Web/Search 和未知 Item。
- 运行中通过原生通知显示增量 Assistant/Tool 输出和 Turn 状态；完成后重新执行 `thread/read`，以原生读结果收敛视图。
- 滚动区支持长列表、跟随最新内容、用户上滚后不强制跳底、跳到最新按钮和展开原始工具字段。

### Composer、Prompt Recovery、Stop

- Composer 发送纯文本到真实 `turn/start`，不拼接历史 Prompt 伪造上下文。
- `NativeThreadRuntime.startTurn` 仍先写 Phase 2 Prompt Recovery，再提交原生 Turn；失败/超时/进程退出时 Prompt 留在持久化记录和 Renderer 草稿中。
- Stop 调用真实 `turn/interrupt`；被中断 Turn 保留在 `thread/read` 中，Thread 不被删除，之后可继续同一 Native Thread。
- Runtime close、重启和显式 resume 继续沿用 Phase 2/3 的 binding、projection、原生 ID 校验和 fail-closed 规则。

### Native Approval

- Main 暂挂真实 JSON-RPC server request，并通过 `native-runtime:server-request` 通知 Renderer；Renderer 的决策通过 `native-runtime:server-request-response` 回到同一个原生 request。
- 支持并严格校验 Codex CLI 0.147.0 的：
  - `item/commandExecution/requestApproval`：`accept`、`acceptForSession`、`decline`、`cancel` 及 schema 中的 amendment 对象；
  - `item/fileChange/requestApproval`：四种原生字符串决策；
  - `item/permissions/requestApproval`：原生 `permissions` 响应，不把自定义 `deny` 假装成协议。
- 未知 server request 继续 fail-closed；重复、过期、非法 response 被拒绝。审批等待有 120 秒上限，应用关闭/进程退出时用对应的原生收束响应释放等待者。
- `src/shared/native-approval.ts` 和测试覆盖方法白名单、命令/文件/权限 response contract。现有 App Server fake contract test 也验证 server request response 能使原生 Turn 完成。

## 验证证据

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS；TypeScript source、tests、scripts 均通过 |
| `npm test` | PASS；32 passed / 0 failed |
| `npm run build` | PASS；BUILD PASS |
| `npm audit --omit=dev` | PASS；0 vulnerabilities |
| secret regex scan | PASS；无匹配 |
| `npm run test:real`（隔离状态目录） | PASS；真实 Codex CLI 0.147.0 创建 Native Thread、完成 Turn、`thread/read` 返回 User + Assistant Item，Projection 为 ready |
| `npm run test:real:navigation` | PASS；3 个真实 Thread、Project/Standalone 归属、A1→A2→Standalone 切换、重启恢复、4 个 completed event |
| `npm run test:real:workspace` | PASS；interrupt 后继续同一 Thread，再重启恢复同一 `nativeThreadId` |

最后一次 workspace smoke 的关键证据：

```text
nativeThreadId: 01a00f88-7fca-7ea3-8436-aedfb047e98c
interruptedTurnId: 01a00f88-8063-7403-b852-01fd667412b5
continuedTurnId: 01a00f88-8346-7731-aefe-155887bfaa91
restartNativeThreadId: 01a00f88-7fca-7ea3-8436-aedfb047e98c
read statuses: interrupted(itemCount=1), completed(itemCount=2)
```

第一次未隔离运行 `npm run test:real` 命中了旧 `.real-smoke` 状态中的活动 writer，Codex 返回 `thread ... already has an active writer`；未复用该状态，改用隔离状态目录后正常通过。这是 smoke 状态冲突，不作为产品通过证据。

## 范围边界与已知限制

- 未实现附件上传：Phase 4 要求附件为可选，当前只开放可靠的纯文本 Composer。
- 未把 Permission Mode、Model、Reasoning Effort 做成伪设置；只有实际 Runtime 支持的协议字段才可扩展。
- 未实现 Map、Plugin Framework、Workflow、Review、Task Manager、Parent/Child、Multi-Agent、Exec、Git Workbench、Custom Context Manager 或 Custom Approval Protocol。
- 本阶段没有进行人工 GUI 操作；按项目约定以 CLI unit/build/audit 和真实 App Server smoke 为验证依据。Native Approval 的真机触发依赖真实审批策略，当前真实 smoke 使用 read-only/never policy，因此审批 UI 以 fake JSON-RPC contract、response validator 和 Main IPC 路径验证，未把未触发的真机审批误报为通过。
- Native Thread 没有原生 title 时，Header 使用真实 `nativeThreadId` 的短显示和完整 ID 元数据，不生成假的会话标题。

## 旧项目保护

`D:\办公\AI\Codex_Workbench` 未被修改；其原有 MNT-FIX-005 等有意保留的未提交状态保持不变。本阶段所有代码、测试、脚本和文档只写入 `D:\办公\AI\Codex_Workbench_V1`。

[CODEX_WORKBENCH_STAGE_REVIEW]
stage: Phase 4 — Codex Thread Workspace
commit: current HEAD — `feat: implement native thread workspace` (see `git log -1`)
changes: Native thread/read rich view, bounded event normalizer, Codex-shaped Thread Workspace, Composer, Prompt Recovery UI, Stop/interrupt, reconnect/failure visibility, native approval broker and contract validation, real workspace smoke
architecture: Native App Server Thread/Turn/Item remains the only runtime truth; Renderer has an in-memory view cache only
thread_header: native identifier, native cwd, Project/Standalone projection, runtime state, reread operation
native_turn_item_stream: thread/read includeTurns plus live native notifications; read result converges after Turn completion
event_normalizer: Native Event → Visible Event Normalizer; bounded params; unknown safe generic
command_tool_file_rendering: native item types and live item events render as Command/Tool, File Change, Web/Search or Unknown
approval: native JSON-RPC server request held in Main; validated native response returned to same request; unknown fail-closed; timeout/close cleanup
composer: text-only prompt to turn/start; no history concatenation; draft retained on failure
prompt_recovery: Phase 2 persistence begin/update/clear/recovery preserved; Renderer draft retained when send/read fails
stop_interrupt: real turn/interrupt; interrupted Turn remains readable and same Thread continues
reconnect_failure: runtime state and inline error banner expose disconnected/recovery/failed/timeout/process exit; restart uses persisted binding and fail-closed identity checks
context_compaction: native compaction-like events normalize to Processing; no custom context manager
thread_switching: Phase 3 single active Runtime slot and busy-switch guard preserved
tests: 32 unit tests pass; identity, navigation, read model, normalizer, approval contract, prompt recovery, interrupt and failure regression covered
real_appserver_smoke: real normal/read, navigation, interrupt→continue→restart workspace smoke pass in isolated state
identity_evidence: final workspace smoke above; real navigation smoke also records 3 Thread IDs and 4 completed events
legacy_project_status: old D:\办公\AI\Codex_Workbench intentionally unchanged
scope_boundary: stopped at Phase 4; no Phase 5/6 or forbidden legacy/map/workflow layers
known_limitations: no attachments; real approval UI not triggered under never/read-only smoke policy; no manual GUI test per project rule
blockers: none
