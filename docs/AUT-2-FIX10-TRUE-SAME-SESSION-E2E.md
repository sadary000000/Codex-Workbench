# AUT-2 Fix10 — True Same-Session E2E

## 结论

`BLOCKED`。两次真实复用尝试都在进入 AlignmentSession 之前失败，当前没有真实的：

```text
NEEDS_INPUT → Answers → READY_FOR_DRAFT → USER confirmation
```

因此不能声称同一 AutomationProject、同一 Store、同一 AlignmentSession 的真实闭环通过。

## 实际尝试

| 尝试 | 目标 Chat | 新建 Chat | setup Prompt | 业务 Prompt | 结果 |
|---|---|---:|---:|---:|---|
| 1 | 已有 canonical REQUIREMENT Chat（`/g/.../c/...`） | 0 | 0 | 0 | `AUT2_REUSE_FAILED` |
| 2 | 当前绑定 REQUIREMENT Chat（`/c/...`） | 0 | 0 | 0 | `AUT2_REUSE_FAILED` |

第二次尝试同样未通过 `chat/latest` 的 Chat identity/history confirmation。Fix10 的 strict 模式正确停止，没有创建替代 Chat、没有 repair、没有发送业务 Prompt。

机器证据见 [AUT-2-FIX10-TRUE-SAME-SESSION-E2E.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-FIX10-TRUE-SAME-SESSION-E2E.json)。

## 已实现但未获真实证据的边界

- 同一次 gate 使用同一 `AutomationStore`、`automationProjectId` 和 `AlignmentSession`。
- Answers 从持久化 Round 的 questionIds 生成。
- questionId 比较和 SHA-256 采用 canonical lexicographic sort；原始向量仍保留在证据中。
- Cross-round / unknown questionId 仍 fail-closed。
- USER confirmation 仍是唯一允许的确认 actor。

这些是静态/自动化能力，不替代真实 Gate 证据。

## 安全与预算

- 本轮真实业务 Prompt：`0`。
- 本轮 setup Prompt：`0`。
- 本轮 repair Prompt：`0`。
- 本轮新 Chat：`0`。
- 历史累计计数：12；本轮上限为 14，剩余业务预算 2。
- 没有发送任何 Prompt、没有读取 Cookie/Token、没有删除或修改生产 Journal。

## 阻塞原因

生产 Journal 当前有 24 条非终态记录（1 QUEUED、21 RECOVERY_REQUIRED；其中 Planner 非终态 3 条），且历史 Planner request `wgpt-f799139b-93f8-42dd-aa02-cadc08eebfd6` 不在生产 Journal。AUT-3 因此不得盲发新 Prompt。
