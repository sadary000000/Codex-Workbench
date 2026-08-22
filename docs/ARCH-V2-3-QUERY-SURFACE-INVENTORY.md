# ARCH-V2-3 Query Surface Inventory

| Surface | Current path | Query contract after ARCH-V2-3 | Explicit mutation/reconcile path |
|---|---|---|---|
| Native Thread | `NativeThreadRuntime.readThread()` | 只读 `thread/read`；不写 projection | `refreshProjectionFromRead()`、start/resume/turn lifecycle |
| Native IPC | `native-runtime:read` | 返回事实或错误；Runtime 错误 fail-closed，不由 `readThread` 写 projection | 选中/恢复/不可用处理仍由显式 navigation/reopen lifecycle 负责 |
| WebGPT runtime status | `webgpt.status`, `webgpt.current` | health/page probe + active journal summary；不导航、不 reconcile、不 submit | `open`, `control.auto`, `open-chat` 等 Command |
| WebGPT current latest | `webgpt.latest` | 当前页面 read lease 下读取，不导航、不写 Journal | `webgpt.chat.latest` / role latest 是目标 Chat 导航型读取，不伪装为纯 status |
| WebGPT request list | `webgpt.request.list --active` | 读取 Journal 中非 terminal 记录，不 reconcile | `webgpt.send`, `webgpt.request.reconcile` |
| WebGPT request status | `webgpt.request.status --request-id` | 默认不 reconcile、不导航、不占恢复租约 | `webgpt.request.reconcile --request-id` |
| Role list/status | `webgpt.role.list/status` | 读取已存在 registry/project 数据 | `role.new`, `role.bind`, `role.open` |
| Automation inspect | `AutomationStore.inspect()` | 纯读文件/现有 SQLite；旧版本返回 `needs_migration` | `AutomationStore.migrate()` |
| Automation get/list/snapshot | `AutomationStore.get/list/snapshot()` | 纯读现有 JSON/SQLite；不拿 writer lock、不 mkdir、不 rename | `transaction`, `create*`, `migrate` |
| Automation diagnostics | `persistenceDiagnostics()` | 仍属于 writable persistence diagnostics，不作为本阶段纯 query 证明 | 显式 Automation host/persistence lifecycle |
| Map maintenance read | `ProjectMapManager.maintenanceRead()` | 不纳入纯 query；它是维护 Runtime lifecycle | Map enable/resume/maintenance Command |

## Classification rule

命名为 status/list/get/inspect/read 的路径不能暗中改变 durable state、拿写租约、导航 Provider、启动隐藏 Runtime 或完成 migration。需要这些动作时，必须通过名称和 contract 明确表达 Command/Reconcile。
