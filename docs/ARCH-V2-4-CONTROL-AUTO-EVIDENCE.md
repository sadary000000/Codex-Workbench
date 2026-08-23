# ARCH-V2-4 FIX-01/FIX-02 Control Auto Evidence

## Call-graph boundary

`WebGptRequestManager.automationControl()` 当前只恢复用户控制后的 live queue/arbiter transition，不调用 `reconcilePending()`。历史请求的 reconcile 只能通过显式 `reconcileRequest()` 路径触发。`tests/arch-v2-4-fix-round-1.test.ts` 用 call counter 与 Journal snapshot 验证 `control.auto` 不触碰历史记录。

## Real safe smoke

```yaml
executable: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
project: workts
realPromptCount: 0
control_user: PASS
user_blocked_project_open: PASS (USER_CONTROL)
control_auto_after_user: PASS
concurrent_project_open: PASS (two invocations, capacity=1)
global_new_chat_clicked: false
cookiesRead: false
tokensRead: false
privatePageContentLogged: false
```

第二次安全 smoke 的 Journal SHA 为 `E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B`，before/after 相同。第一次 run 因旧断言未接受公开 `USER_CONTROL` 名称而失败；其 SHA 变化 `E116...E77B0 → 7D2F...661CE` 保留为历史事故证据，没有 rollback。
