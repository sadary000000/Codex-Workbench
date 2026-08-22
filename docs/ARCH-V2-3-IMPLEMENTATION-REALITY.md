# ARCH-V2-3 Implementation Reality

## Scope Resolution

```yaml
stage_name: ARCH-V2-3 Query / Command / Reconcile Separation
goal: 让 Native、WebGPT、Automation 与 CLI 的查询面保持纯读，显式命令承担变更，Provider reconciliation 只能由显式入口触发
in_scope:
  - Native readThread 与 ThreadProjection 的查询/刷新分离
  - WebGPT request status/list/latest 的查询边界与显式 request reconcile
  - Automation inspect/get/list/snapshot 的只读路径与显式 migrate
  - CLI / Control Plane query-command contract
  - contract/unit/high-fidelity fixture evidence
out_of_scope:
  - ARCH-V2-4 External Action redesign
  - WebGPT real prompt、页面探索或 Automation 产品功能
  - ActionIntent/Attempt/Receipt、ResourceCoordinator、PolicyVersion 重设计
  - RuntimeRegistry、Shared Host、Codex protocol、Map、Renderer 全量重构
architecture_boundary:
  Native: Native Thread/Turn/Item 事实由 Codex App Server 持有
  WebGPT: 页面/provider 状态由 WebGPT Runtime 与 Request Journal 管理
  Automation: Automation Store 是独立业务状态存储
  Projection: Workbench projection/cache 非权威事实，必须通过显式写入入口更新
```

## Baseline

- Base: `7b1fb2a7243297fe46806a1396358376c17f2f7d`
- ARCH-V2-1 / ARCH-V2-2 已由 GPT PASS；本阶段不重做 Shared Host、Native truth 或 Map 设计。
- 本阶段没有真实 WebGPT Prompt，也没有读取用户 Cookie、Token、聊天内容或生产 Automation 数据。

## Confirmed pre-fix violations

1. `NativeThreadRuntime.readThread()` 在 `thread/read` 后写入 `ThreadProjection`，失败时也写入状态/错误。
2. `WebGptRequestManager.requestStatus()` 默认 `reconcile=true`，恢复状态查询可能导航、占用恢复租约并写 Request Journal。
3. `AutomationStore.inspect()` 通过迁移恢复路径，SQLite 查询会打开写路径并初始化 metadata；`get/list/snapshot` 也可能隐式创建/迁移数据库。
4. Automation writer lock 的竞争异常路径可能删除其他进程的锁标记。

## Implemented separation

- Native `readThread()` 现在只执行 App Server `thread/read`，错误只更新 live Runtime 的 fail-closed 内存状态；新增显式 `refreshProjectionFromRead()` 负责 projection 刷新。
- WebGPT `requestStatus(requestId)` 默认纯读；新增显式 `webgpt.request.reconcile` / `request reconcile --request-id` 调用 `reconcileRequest()`。
- Automation `inspect()` 使用现有 SQLite 文件的 query-only connection，不创建 writer lock、目录、表、metadata 或迁移备份；旧 document schema 返回 `needs_migration` / `NEEDS_MIGRATION`。
- Automation `snapshot/get/list` 读取现有 JSON/SQLite 的纯读视图；数据库创建、JSON/SQLite migration 和 interrupted migration recovery 由显式 `migrate()` / transaction writer 路径承担。
- 修复 writer lock：`wx` 竞争失败不再无条件删除现有锁文件；只有确认 stale owner 时才清理。

## Evidence boundary

自动化证据使用 Node test + temporary fixtures。真实 Native App Server 回归、ARCH-V2-1/2 回归、package 与最终审查包结果写入本阶段最终报告，不将 fixture 证据冒充真实 WebGPT 或 GUI 证据。
