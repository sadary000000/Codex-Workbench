# AUT-2 Gate Fix 5 Recovery Lease Evidence

## Result

`BLOCKED` / `FIX_REQUIRED`

本轮按 Gate Fix 5 只使用现有 Official CLI 和冻结 WebGPT 生命周期能力。没有修改 `src/features/webgpt/**`，没有发送真实 Requirement Prompt，也没有创建新 Chat。

## Recovery sequence

1. 初始只读状态显示 Workbench/WebGPT 尚未可用；持久化 Journal 没有 `SUBMITTED`、`RUNNING` 或 `GENERATING` 请求，只有历史 `RECOVERY_REQUIRED` / `PAUSED_FOR_USER` 记录。
2. 以 5 秒间隔执行最多 120 秒的只读状态等待；期间没有 Prompt，租约没有在等待窗口内自行收敛，状态持续表现为 `WORKBENCH_START_TIMEOUT`。
3. 在确认没有 in-flight 请求后执行现有 `webgpt close --json`，返回 `ok=true`、`closeMode=GRACEFUL`。没有使用 `taskkill`，没有删除 Session 或 Request Journal。
4. 正常启动打包 GUI Host，并执行 `webgpt open --json`。页面恢复、`loginRequired=false`，没有重新登录。
5. 初次 `control auto` 仍返回 `TIMEOUT / WORKBENCH_START_TIMEOUT`。随后在正常生命周期与目标导航后，`status --json` 最终显示 `READY / AUTO_CONTROL / browserResource=FREE / queueDepth=0`。
6. 使用已有目标 Chat URL 执行 `open-chat`，导航命令本身成功；但随后只读 `chat latest --url <target>` 仍连续返回 `TARGET_CHAT_MISMATCH`，因此没有临时替换 REQUIREMENT binding，也没有继续发送业务 Prompt。

## Exact binding safety

目标 Project 为 `workts`，Project ID 为 `371c3fb8-30ac-4943-9584-1915045ea34d`，目标 REQUIREMENT 测试 Chat 为：

`https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workts/c/6a88873d-0af0-83e8-a2e7-202adf2560f8`

现有 `role status --project ... --role requirement --json` 仍指向原绑定：

`https://chatgpt.com/c/6a865d21-8de8-83e9-a1d3-f17c726f91bc`

由于目标 Chat 没有先通过 exact open/read 验证，本轮没有执行 `role bind --replace`。原 binding 未被覆盖，未创建替代 Chat。

## Evidence matrix

| Evidence | Result |
|---|---|
| bounded wait | 120 秒上限，Prompt 数量 0，未在窗口内收敛 |
| normal close | PASS，GRACEFUL |
| normal restart | PASS_PARTIAL，Host 进程存活，`webgpt open` READY |
| login/session recovery | PASS，`loginRequired=false` |
| control owner after lifecycle | PASS_PARTIAL，最终 `AUTO_CONTROL` |
| browser lease after lifecycle | PASS_PARTIAL，`FREE`，active operation/request 为空，队列 0 |
| exact REQUIREMENT Chat read | FAIL，`TARGET_CHAT_MISMATCH` |
| real Requirement Prompt | NOT_STARTED，预算保护 |
| new Chat / replacement Chat | 0 |
| blind resend | NO |

## Budget and safety

- 本轮新业务 Prompt：`0`
- 本轮 repair Prompt：`0`
- 本轮 setup Prompt：`0`
- 本轮新测试 Chat：`0`
- 累计真实业务 Prompt：`7/12`
- 累计 repair Prompt：`2/3`
- 累计新测试 Chat：`2/3`
- 未读取 Cookie、Token、Browser profile 或原始聊天正文。

完整机器证据见 [AUT-2-RECOVERY-LEASE-EVIDENCE.json](D:/办公/AI/Codex_Workbench_V1/docs/AUT-2-RECOVERY-LEASE-EVIDENCE.json)。

## Gate conclusion

恢复控制最终恢复到可用状态，但现有 REQUIREMENT 测试 Chat 的 exact read 仍失败。由于无法证明目标 Chat 身份，继续 `NEEDS_INPUT → Answers → READY_FOR_DRAFT` 会违反 fail-closed 和 exact binding 要求。因此 AUT-2 保持 `FIX_REQUIRED/BLOCKED`，不得进入 AUT-3。
