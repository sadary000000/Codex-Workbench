# WEBGPT-WEB6.5 — CLI 定向读取能力

## 阶段结论

本阶段实现已完成，自动化 Gate 通过；真实网页 Gate A–C 在当前本机状态下未能安全完成，因此阶段结论为 `BLOCKED`，不把未观察到的真实网页结果写成 PASS。

```yaml
stage: WEB-6.5 CLI Targeted Latest Read
implementation_gate: PASS
real_gate: BLOCKED
real_prompt_budget_used: 0/1
v1_frozen_core_changed: NO
project_create_implemented: NO
```

## Scope Resolution

### In scope

- `webgpt latest`：读取当前 WebGPT Browser 正在显示的 Chat 的最后一条完整 Assistant 回复，不导航、不创建 Request。
- `webgpt chat latest --url <chat-url>`：通过现有 Browser Lease 导航到精确 Chat，验证目标身份，再读取最后一条完整回复；结束后停留在目标 Chat。
- `webgpt role latest --project <workbench-project-id> --role <role>`：从 Role Registry 读取已绑定 Chat，经过同一 Core/Lease 定向读取，不修改 Binding。
- 三个命令的 `--json` 和 `--out <file>`。
- 生成中、无 Assistant、错误 Chat、USER_CONTROL、active SEND 和读写竞争的 fail-closed 行为。

### Out of scope

- `project create`（延后 WEB-6.6）。
- 完整 Transcript、历史扫描、Sidebar 枚举、Automation 任务身份。
- 新 Browser、第二套 Selector、第二套 Conversation/Transcript truth。

## Architecture Boundary

```text
CLI / GUI / future Automation
            ↓
      WebGPT Core
            ↓
     Global Operation Arbiter
            ↓
       Browser Lease (1)
            ↓
       Page Adapter Probe
```

`latest` 与 `result --request-id` 保持不同语义：前者是当前页面的 bounded read，后者是某个 Workbench Request 的结果。`latest` 永远不是 Automation 的正式 Request 身份来源。

## Implementation

- `src/main/webgpt-command.ts`：新增三条 CLI 解析路径及严格参数白名单。
- `src/main/webgpt-control.ts`：新增 Control Plane allowlist 和 direct read / navigation read 路由；Windows 冷启动使用 detached executable，不再通过 `cmd /c start` 产生额外命令壳。
- `src/main/main.ts`：统一 JSON/普通文本/`--out` 输出；输出只保存 UTF-8 Assistant 正文，JSON 仅返回 bounded metadata、路径和 hash。
- `src/features/webgpt/runtime/webgpt-workspace.ts`：复用 Page Probe，要求 Chat 身份、生成状态和 Assistant 快照稳定；生成中、变更中或不稳定时不返回正文。
- `src/features/webgpt/runtime/webgpt-request-manager.ts`：当前页面读取拒绝 active Request；指定 Chat 读取经 Arbiter/Browser Lease，并保留目标身份校验。
- `src/features/webgpt/runtime/webgpt-role-session-service.ts`：Role Registry 精确绑定读取，前后 Binding 不变。
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts`：bounded read 与写 Lease 互斥，避免读写交错。
- `tests/webgpt-*.test.ts`：CLI、Control Plane、稳定快照、URL/身份、Lease、USER_CONTROL、Role Binding、`--out` 和回归覆盖。

## Integrity Rules

1. `generating=true` 或 Assistant 快照仍在变化时返回 `WEBGPT_RESPONSE_IN_PROGRESS` / 等价错误；正文为 `null`，`textLength=0`，`textSha256=null`。
2. 没有有效 Assistant 时返回 `NO_ASSISTANT_RESPONSE`，不返回 `ok=true` 空字符串。
3. `chat latest` / `role latest` 只接受既有 ChatGPT Chat URL 规范化形式，导航后再次验证目标 URL。
4. USER_CONTROL 不被定向导航抢占；写操作持有 Lease 时 bounded read 不越过 Lease。
5. Role latest 不扫描历史、不创建替代 Chat、不 silent rebind、不写入 Request Journal。
6. 审查资料和正式日志不包含 Prompt、Assistant 正文、Cookie、Token、Browser Profile 或私人聊天内容。

## Automated Verification

| 命令 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，184/184 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS（仅换行风格 warning） |
| 变更文件 secret scan | PASS；仅发现协议字段名/测试策略字样，无凭据值 |

自动测试中同时覆盖了 WEB-5 idempotency/no-resend、Request recovery、WEB-6.3 network candidate、WEB-6.4 Browser Arbiter/USER_CONTROL，以及本阶段 A–F contract/unit 场景。

## Real Package Smoke（无新增 Prompt）

测试目标均为：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
```

调用方式使用 Node `execFile`，没有使用 PowerShell `& exe command`，本轮 `real_prompt_count=0`。

| 命令/场景 | 观察 | 结论 |
|---|---|---|
| `webgpt status --json`（Workbench 已启动） | 真实 Control Plane 返回 `ok=true`、`workbench=READY`，约 159ms | PASS |
| `webgpt latest --json` | 当前持久 Request Journal 有 19 个未结束 Request；返回 `WEBGPT_RESPONSE_IN_PROGRESS`、`generating=true`、`assistantCount=0`、`textLength=0`、hash 为 null，无正文 | PASS（真实 fail-closed，未完成 Chat Gate） |
| `webgpt chat latest --url ... --json` | 当前控制权为 USER_CONTROL，返回 `WEBGPT_AUTOMATION_PAUSED`，未抢页面、未发送 Prompt | PASS（边界证据，未完成指定 Chat Gate） |
| `webgpt role latest --project missing-project --role PLANNER --json` | 返回 `PROJECT_NOT_FOUND`，未扫描历史、未改变 Binding | PASS（边界证据，未完成真实 Role Chat Gate） |
| 冷启动 `status` | 直接 detached spawn 能取得真实 status 响应；`execFile` 的 `close` 事件仍可能被新宿主 Electron 子进程持有的输出句柄延迟到调用超时，需在干净环境进一步处理 | BLOCKED / known limitation |

真实 Gate A–C 需要一个当前已完成、可安全读取的有效 Chat、可用的 WebGPT Automation 控制权和有效 Role Binding。本轮发现的 `activeRequestCount=19` 与 USER_CONTROL 状态均未被清理或篡改，避免为了 Gate 删除用户 Request 或抢占用户页面。

## Real Gate Matrix

| Gate | Contract/Unit | 本轮真实网页 |
|---|---:|---:|
| 当前 Chat latest 完整回复 | PASS | BLOCKED：没有安全的 completed page snapshot |
| 当前 Chat latest 不返回半截 | PASS | PASS：真实返回 `WEBGPT_RESPONSE_IN_PROGRESS` |
| 指定 Chat exact target | PASS | BLOCKED：USER_CONTROL，未抢占页面 |
| 指定 Chat Lease | PASS | PASS（contract） |
| Role exact binding | PASS | BLOCKED：本轮没有安全有效 Role binding |
| Role 不 silent rebind | PASS | PASS（contract） |
| active SEND 不被读取抢占 | PASS | PASS |
| USER_CONTROL boundary | PASS | PASS（真实返回暂停错误） |
| `--out` / JSON | PASS | PASS（unit/contract；本轮无正文写出） |

## Privacy / Evidence Boundary

审查包只保存 `assistantCount`、`generating`、`textLength`、`textSha256`、错误码、目标 hash/有限 URL 元数据和时间线，不保存真实回复正文。当前 GUI Projection 中既有的 bounded preview 不属于本阶段新增日志或审查包内容。

## Subagents

- Confucius：完成 CLI/parser/Control Plane 只读审计；确认新增命令应复用现有 Control Plane，未采用其与当前页面语义冲突的 Journal 方案。
- Fermat：完成 Page Adapter/Request/Role/Arbiter/隐私只读审计；采用稳定 Assistant 快照、严格目标 URL、读写互斥和不改 Binding 的建议。
- 两个子代理均自然完成并已关闭；Gate 时 `running_subagents=0`。

## Known Limitations / Blockers

- 本轮没有安全完成 Real Gate A–C，不把 contract 证据冒充为真实网页 PASS。
- 当前用户数据中的 active Request 和 USER_CONTROL 状态保留原样；需要用户在不影响真实账号的前提下，提供一个已完成有效 Chat、AUTO_CONTROL 和有效 Role Binding 后再复测。
- Windows 冷启动的 `execFile` close 句柄延迟仍需独立处理；暖启动 Control Plane 响应已验证快速。

## Provenance

- Base commit：`10e03e7`（WEB-6.4 review package）
- Implementation commit：`4ebf743`
- Final package：`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`
- 具体 hashes 见 `docs/WEBGPT-WEB6.5-STAGE-REVIEW.md` 和审查包内 provenance 文件。
