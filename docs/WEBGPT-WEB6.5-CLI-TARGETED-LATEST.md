# WEBGPT-WEB6.5 — CLI 定向读取能力最终收口

## 阶段结论

本轮最小 Gate Fix 已完成，自动化 Gate、正向定向读取、Role 定向读取和 Windows 冷启动 execFile 生命周期均有证据；但唯一允许的真实 Prompt 在完成前未捕获到稳定的 GENERATING 窗口，无法诚实证明“中断 → 重启 → 同一请求恢复且不重发”。因此最终真实 Gate 保持 BLOCKED，不把部分证据写成完整 PASS。

yaml:
stage: WEB-6.5 CLI Targeted Latest Read - Final Closeout
implementation_gate: PASS
real_gate: BLOCKED
real_prompt_budget: 1/1
v1_frozen_core_changed: NO
webgpt_code_changed: YES
next_stage: WEB-6.6 NOT_STARTED

## Scope Resolution

### In scope

- webgpt latest：读取当前浏览器 Chat 的最后一条完整 Assistant 回复，不创建 Request、不发送 Prompt。
- webgpt chat latest --url <chat-url>：导航到精确目标 Chat，确认目标身份和历史已加载后读取最后一条完整回复。
- webgpt role latest --project <project-id> --role <role>：从 Role Registry 读取已绑定 Chat，不修改 Binding。
- 当前页面读取只按目标 Chat 阻止同目标的实时 SEND；其他 Chat 的历史/恢复残留不能全局阻塞无关目标。
- Windows 冷启动、CLI 输出流关闭、Control Plane STARTING 重试与真实 execFile 关闭生命周期。

### Out of scope

- 不进入 WEB-6.6；不新增 Automation、Planner、Reviewer 或 Workflow。
- 不重做 V1 Frozen Core、Native Thread/Turn/Item、Conversation truth、Runtime Registry 或 Browser 架构。
- 不扫描历史 Chat、不删除或清空 Request Journal、不读取 Cookie/Token/Browser Profile、不记录 Prompt 或 Assistant 正文。

## 根因与最小修复

### A — Target-aware latest read

此前 readLatestCurrent 按全局未结束 Request 数量阻塞。当前 Request Journal 的 64 条记录中，45 条为终态（34 COMPLETED、11 FAILED），19 条为重启/用户控制遗留（17 RECOVERY_REQUIRED、2 PAUSED_FOR_USER），并不等于当前页面有 19 个实时生成。现在只比较当前页面 URL 与 Request 的 targetChatUrl/chatUrl，只对同目标的 SUBMITTING、SUBMITTED、GENERATING fail-closed；不相关 Chat 不再阻塞。

### B — 冷启动与输出流生命周期

Windows 下直接 detached Electron 子进程会让宿主继承 CLI 输出句柄，导致 Node execFile 的 close 延迟；直接非 detached 又会随 CLI 父进程退出而杀死 GUI。当前实现通过 Windows explorer.exe 的 ShellExecute 路径启动可见 EXE，CLI 本身保持 stdio: ignore，并在输出完成后显式结束 stdout/stderr 再退出；不使用 cmd /c start，也不留下命令壳。

### C — GPT-scoped Chat URL / 历史加载竞态

ChatGPT 网页实际存在 /g/<gpt-id>/c/<chat-id> 形式。Role URL 校验、目标 Chat 校验均接受标准 /c/<chat-id> 与 GPT-scoped 形式。定向导航后增加有界的目标历史等待：先再次确认 URL，再等待 generating=true 或 Assistant 历史出现，避免 Composer 已出现但历史尚未填充时误报“无 Assistant”。

## Implementation

- src/features/webgpt/runtime/webgpt-request-manager.ts：当前页读取改为按目标 Chat 过滤实时 Request；定向读取增加目标历史加载等待。
- src/features/webgpt/runtime/webgpt-role-session-registry.ts：接受 GPT-scoped Chat URL，同时继续拒绝设置页等非 Chat URL。
- src/features/webgpt/runtime/webgpt-workspace.ts：增加目标 Chat 历史加载的有界等待与身份校验。
- src/main/webgpt-control.ts：STARTING/WORKBENCH_NOT_READY 使用新的请求 ID 重试；可达实例不重复启动；Windows 使用 Explorer 原生启动路径。
- src/main/main.ts：CLI 路径不等待 GUI app.whenReady；输出写完后关闭 stdout/stderr，再以确定退出码结束。
- tests/webgpt-control-contract.test.ts：覆盖 GPT-scoped Role URL 与冷启动 STARTING → READY 不复用缓存响应。
- tests/webgpt-feature-contract.test.ts：覆盖 CLI 生命周期、Explorer 启动、无 cmd /c start 等静态契约。
- tests/webgpt-request-manager.test.ts：覆盖无关 Chat 不阻塞、同目标实时 Request fail-closed 与测试工作区契约。

## Automated Verification

| 命令 | 结果 |
|---|---|
| npm run check | PASS |
| npm test | PASS，184/184 |
| npm run build | PASS |
| npm run package:win | PASS |
| npm audit --omit=dev | PASS，0 vulnerabilities |
| git diff --check | PASS；仅换行风格 warning |
| changed-source/review secret scan | PASS；未发现凭据值 |

本轮实现提交：48b0f7041dc6056294677be914263e6902732c66。

## Real Package Smoke（仅 1 个真实 Prompt）

### 环境与调用边界

- 测试 EXE：D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe。
- 所有 CLI 调用使用 Node execFile，未使用 PowerShell & exe command。
- 本阶段实际发送真实网页 Prompt：1/1；Prompt 正文不进入报告或 ZIP。
- 未发送第二个 Prompt，未扫描历史 Chat，未清理用户 Request，未抢占 USER_CONTROL。

### 正向读取证据

| 场景 | 真实观察 | 结论 |
|---|---|---|
| 一次真实发送/等待/结果 | 同一 requestId=wgpt-7a12d14a-af85-46ba-bf30-dc2d83e2731f；send → QUEUED，wait → COMPLETED；结果 26 bytes，hash b3bf787547cc7db959cab5609f672adde34d91fe4ea38a0949922dbb2f8a94f7 | PASS；未重复发送 |
| webgpt latest --json | 当前目标页 assistantCount=1、generating=false、textLength=26，hash 与 result 一致 | PASS |
| webgpt latest --out <absolute-temp> | 生成文件 26 bytes，hash 与 result 一致；测试后删除临时输出文件 | PASS |
| webgpt project open --name workts 后精确 webgpt chat latest --url <target> | 从 Project 路由进入目标 GPT-scoped Chat；targetMatches=true、assistantCount=1、generating=false、hash 一致；wrongChatRead=0 | PASS |
| 临时测试 Role Binding → role latest → 恢复原 Binding | 测试 Project 的 PLANNER 临时绑定读取同一目标 Chat 成功；恢复后 sameUrl=true、状态 BOUND | PASS；未 silent rebind |

所有报告只保留 URL 形式 https://chatgpt.com/g/<gpt-id>/c/<chat-id> 和 hash，不保留真实 Chat URL、Prompt 或回复正文。

### Windows cold-start execFile

在清洁的“无目标 EXE 进程、旧 descriptor 已隔离”前提下，最新打包 EXE 的真实 Node execFile 结果：

yaml:
cold:
  exitCode: 0
  signal: null
  elapsedMs: 1848
  workbench: READY
  gui_remained_alive: YES
warm:
  exitCode: 0
  signal: null
  elapsedMs: 167
  workbench: READY
  gui_remained_alive: YES
shell: execFile
cmd_shell: NO

这闭环了本轮 Windows 冷启动问题。

## Final Real Gate Matrix

| Gate | Contract/Unit | Real evidence |
|---|---:|---:|
| A1：in-flight interruption → restart → no resend | PASS | NOT_PROVEN：唯一 Prompt 在捕获到稳定 GENERATING 窗口前已完成；没有再次发送以补测 |
| A2：target-aware latest read | PASS | PASS：无关 19 条历史/恢复记录不再全局阻塞；同目标实时状态仍 fail-closed |
| A3：positive latest / --out | PASS | PASS：结果与定向读取 hash 一致 |
| B：Role exact target read | PASS | PASS：临时测试 Binding 读取成功并恢复原 Binding |
| C：cold-start execFile close | PASS | PASS：cold/warm 均正常退出，GUI 保持运行 |
| no prompt duplication | PASS（contract） | 观察到的真实运行 duplicatePromptCount=0，但没有重启中的生成窗口证据 |

### A1 明确缺口

yaml:
fresh_real_generating_window_observed: NO
sameRequestId_after_restart: NOT_ESTABLISHED
duplicatePromptCount_in_observed_run: 0
idempotencyKey_in_persisted_real_record: NOT_PRESENT
semanticSha256_present: YES

Real Request Journal 的正向记录包含 requestId、语义 hash、Prompt hash 和结果 hash，但本次 CLI 真实发送没有持久化非空 idempotencyKey。代码/单元测试中的 idempotency 与 recovery contract 仍 PASS；在不新增真实 Prompt 的约束下，这一点不能包装成真实 A1 PASS。

## Privacy / Evidence Boundary

审查包只保存状态、计数、长度、hash、错误码、有限 URL 形式、Request ID 和时间/耗时元数据。禁止包含 Prompt、Assistant 正文、Cookie、Token、Browser Profile、认证信息或私人聊天内容。

## Subagents

- Cicero：自然完成 Request Journal 分类与 target-aware read 审计；确认 19 条为历史/恢复状态，不应作为全局实时生成计数；结果已审核并采用。
- Nietzsche：自然完成 Windows spawnWorkbench/execFile 生命周期审计；比较 detached、attached 与 Explorer 启动方案；结果已审核并采用。
- 两个子代理均已在审核结果后关闭；Gate 时 running_subagents=0。

## Known Limitations / Blockers

- 严格 Real Gate A1 仍未闭环：没有在唯一 Prompt 的实时生成窗口执行中断/重启验证；不得再发 Prompt 补测。
- 真实记录的本次 CLI 发送未持久化非空 idempotencyKey，只有 semantic/prompt hash；后续若要把真实 A1 升格为 PASS，应在不重复发送的前提下补充可审计的 key 生成/持久化证据。
- 额外观察：webgpt chat latest --out <absolute-temp> 的直接 Node execFile 路径曾出现 Windows 0xffffffff 且无输出文件；chat latest 无 --out、raw Control Plane 同命令和本阶段要求的 webgpt latest --out 均正常。该边缘问题未被用于 PASS，保留为后续 CLI 边界项。
- 不进入 WEB-6.6，不新增 Automation。

## Provenance

- Base commit：3504c67（前一份 WEB-6.5 审查包）
- Implementation commit：48b0f7041dc6056294677be914263e6902732c66
- Final review/freeze commit：本轮 review-package commit（实际 hash 见 Git HEAD）
- Package：D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
- App/resource hashes：见 dist/review/WEBGPT-WEB6.5-PROVENANCE.txt

## Decision

实现 Gate：PASS；正向读取、Role、冷启动证据：PASS；严格 A1 真实重启/无重发证据：NOT_PROVEN。最终阶段状态：BLOCKED。建议将本审查包提交 GPT 审查，不进入 WEB-6.6。
