# ARCH-V2-3 Reconcile Evidence

## WebGPT

```text
request status <id>       -> read current Journal record
request reconcile <id>    -> explicit reconcileRequest(id)
```

`reconcileRequest()` 可以要求 `AUTO_CONTROL`、目标校验、恢复租约、页面导航和 Journal 更新；它永远不自动重放原 Prompt。状态查询不触发这些动作。

## Native

Native projection refresh 同样被显式命名为 `refreshProjectionFromRead()`。普通 `readThread()` 只返回 App Server 事实。

## Automation

Persistence migration/recovery 通过 `AutomationStore.migrate()` 或已有 writer transaction 路径执行；inspect/get/list/snapshot 不替代用户选择而自动迁移。

## Negative evidence

没有新建替代 Thread、没有重建 Transcript、没有发送真实 WebGPT Prompt，也没有把 provider reconciliation 隐藏在 status/list/read 名称后面。
