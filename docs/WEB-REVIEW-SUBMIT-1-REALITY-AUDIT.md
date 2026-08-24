# WEB-REVIEW-SUBMIT-1 现实审计

日期：2026-08-24

## 结论摘要

本阶段把 Review Package 提交能力以增量方式接入 Workbench 的既有 WebGPT 运行时。接入没有复制独立 Runner 的 Edge/Playwright 浏览器、persistent profile 或第二套控制会话。

| 项目 | 结论 |
| --- | --- |
| Workbench 复用既有 WebContentsView / Session | YES |
| Workbench 复用既有 Page Adapter | YES |
| Workbench 复用既有 Browser Arbiter | YES |
| 独立 Runner 10 次真实提交 | 10/10 SENT |
| 独立 Runner 重复发送 | 0 |
| 独立 Runner median | 13,436 ms（未达到原始 <=10 s 目标） |
| 独立 Runner p90 | 14,742 ms（达到 <=15 s 目标） |
| Workbench 正向打包 GUI smoke | 未宣称；需使用已登录 Workbench WebGPT 会话，不以静态/负向结果冒充 PASS |
| Workbench warm packaged lifecycle | 304 ms，`CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL`，Prompt=0 |
| Workbench cold packaged CLI lifecycle（修复后） | 1,204 ms 返回，Prompt=0 |

因此本报告将集成状态记为 `PASS_CANDIDATE_WITH_REAL_SMOKE_BOUNDARY`，不是宣称 Workbench 已完成真实正向网页提交 Gate。冷启动“进程不返回”问题已修复；剩余边界是未登录/未打开 WebGPT 时不会产生正向 `SENT`。

## 输入来源

- 独立 Runner 仓库：`D:\办公\AI\Codex_ChatGPT_Submission_Runner`
- 独立 Runner 验证 HEAD：`4bbd6a0abfcda4b3841f58a037bce203450b187b`
- Workbench 目标仓库：`D:\办公\AI\Codex_Workbench_V1`
- 独立 Runner 的当前未提交改动仅用于其本地 Edge/浏览器上下文注入；本阶段没有把它复制到 Workbench。

## 关键现实证据

独立 Runner 已完成过真实网页验证：10 次均为 `SENT`，`duplicate_send_count=0`，median 为 13.436 秒、p90 为 14.742 秒、max 为 15.570 秒。随后一次单次提交为 10.644 秒，同一幂等输入再次调用返回 `ALREADY_SENT`，没有第二次浏览器发送。

原始 median <=10 秒目标未达到；用户已确认当前水平暂时可接受。本阶段不通过重复真实 Prompt 来掩盖这个差异。

## 冷启动返回修复证据

官方 CLI 启动器原先让 Electron 运行时继承调用方的标准句柄。修复后使用 `CreateProcess(..., inheritHandles=false)`，结果仍通过显式临时文件回传，避免 Electron 子进程持有 Node `execFile` 管道。

修复后 packaged CLI 实测：冷启动 `webgpt status --json` 约 1,204 ms 返回；`webgpt open --json` 约 8,492 ms 完成可见页面与 Composer 准备；随后 warm `status` 约 241 ms、`close` 约 217 ms。所有操作 Prompt=0，关闭后未留下目标 Workbench 进程。

## 安全与边界

- 目标只能是 `current` 或调用方明确给出的 ChatGPT Chat URL。
- 不扫描历史 Chat，不猜目标，不自动新建业务 Chat。
- 不读取、导出或持久化 Cookie、Token、密码或聊天全文。
- Ledger 只保存目标规范化值、ZIP/摘要哈希、状态、时间、有限验证元数据和脱敏错误；它不是 Conversation/Transcript truth。
- 发送后验证超时进入 `UNKNOWN_AFTER_SEND`，先 reconcile；不得盲目重发。
- 用户接管或 Arbiter 不可用时返回 `CONTROL_NOT_AVAILABLE`。

## 未宣称事项

没有把当前 Codex 内置浏览器、独立 Runner 或用户当前 Edge 页面当作 Workbench WebContentsView 的正向证明。Workbench 的正向打包 smoke 必须在 Workbench 自己已登录、AUTO_CONTROL 可用且目标页可访问时执行；若环境未登录，正确结果是 `AUTH_REQUIRED`。

本轮的 packaged lifecycle 证据只覆盖启动后 typed failure 与无 Prompt 退出安全；不覆盖已登录目标 Chat 的正向 `SENT`。
