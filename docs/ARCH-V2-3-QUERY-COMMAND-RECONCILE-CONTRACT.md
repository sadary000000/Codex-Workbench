# ARCH-V2-3 Query / Command / Reconcile Contract

## Query

Query 可以读取权威 Provider 或现有本地状态，但不得：

- submit/cancel Prompt；
- 导航到目标 Chat；
- 获取 exclusive/write browser lease；
- 调用 reconcile；
- 创建目录、数据库、迁移备份、writer lock 或 replacement Thread；
- 写 Native Thread projection、Request Journal、Role/Project registry。

## Command

Command 明确表示生命周期、导航、控制或持久化改变，例如 Native start/resume、WebGPT open/open-chat/send/control、Automation transaction/migrate。Command 必须保留已有 target/identity/lease/diagnostics 约束。

## Reconcile

Reconcile 是显式恢复动作，不属于 status 查询：

```text
webgpt.request.status --request-id <id>
  -> returns current Journal record only

webgpt.request.reconcile --request-id <id>
  -> calls reconcileRequest(id)
  -> may require AUTO_CONTROL, target validation, recovery lease, navigation and Journal update
  -> never replays the original Prompt
```

Native projection refresh 同样显式：

```text
readThread()
  -> provider facts only

refreshProjectionFromRead(read)
  -> explicit non-authoritative projection update
```

## Automation migration

`AutomationStore.inspect()` 对已存在文件执行纯读检查。旧 SQLite document schema 返回 `status: needs_migration` 与 `message` 中的 `NEEDS_MIGRATION`，不自行恢复或迁移。`AutomationStore.migrate()` 是显式写入口，保留原有 interrupted migration recovery、JSON backup 和 SQLite metadata migration 行为。
