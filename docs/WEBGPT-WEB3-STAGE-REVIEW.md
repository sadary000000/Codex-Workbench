# Codex Workbench WebGPT — WEB-3 阶段审查报告

## 1. Executive Summary

```text
stage: WEB-3 CLI WebGPT Prompt/Response Roundtrip
local_result: PASS_WITH_ISSUES_CANDIDATE
blocking_issue: NO
v1_frozen_core_changed: NO
multi_account: DEFERRED
```

WEB-3 已在当前 Workbench 的正式 WebGPT Runtime 上完成 CLI Prompt/Response 闭环：CLI 通过版本化 Control Plane 进入 Main-owned Request Manager，再由同一个 Electron `WebContentsView` / 持久 Session 操作已登录的 `chatgpt.com` 页面，最终通过 `wait` / `result` 读取真实网页回答。

本阶段过程中发现并修复了一项真实完成检测缺陷：页面中间态“正在思考”曾被错误标记为 `COMPLETED`。修复后重新打包并重新执行三轮真实往返，三轮均返回最终答案，不再把该中间态作为结果。

## 2. Architecture

```text
CLI
  ↓
authenticated versioned Control Plane socket
  ↓
Main WebGptRequestManager
  ↓
WebGptWorkspace / one WebContentsView / one persistent Session
  ↓
ChatGPTPageAdapter
  ↓
chatgpt.com
  ↓
page probe + completion detection
  ↓
persisted request metadata + UTF-8 result file
  ↓
CLI wait / result
```

不创建第二个 Browser、第二个 Electron Session 或无头浏览器。CLI 不持有 DOM、`WebContentsView` 或页面自动化逻辑；页面选择器和 JavaScript 只位于内部 Page Adapter。

## 3. Scope Resolution

### In scope

- `webgpt new-chat`
- `webgpt open-chat --url <chat-url>`
- `webgpt send --text <text>`
- `webgpt send --file <prompt.md|prompt.txt>`
- `webgpt wait --request-id <id> [--timeout-ms <n>]`
- `webgpt result --request-id <id> [--out <file>]`
- 同一 WebGPT Runtime 的异步请求状态、结果持久化和 CLI 自动启动
- AUTO_CONTROL / USER_CONTROL / PAUSED 的安全边界
- GPT streaming 完成检测和中间态过滤

### Out of scope

- 多账号 / 多 Session
- Browser Agent、通用网页自动化、Edge CDP
- Playwright、Selenium、自研 CDP
- ChatGPT 私有 API 或认证 Token/Cookie 读取
- 文件附件上传
- Automation / Workflow / Planner / Reviewer 产品层
- 多 Tab 和模型自动切换

## 4. CLI Contract

| 命令 | 输入 | 成功结果 | 失败行为 |
|---|---|---|---|
| `webgpt new-chat` | `--json` 可选 | 返回实际页面 URL、页面状态、控制模式 | 保留真实页面状态，不伪造 Chat ID |
| `webgpt open-chat` | `--url https://chatgpt.com/c/...` | 返回实际加载 URL、页面状态、控制模式 | 非 ChatGPT URL fail-closed |
| `webgpt send` | `--text` 或 `.md/.txt` 的 `--file`，二者互斥 | 立即返回 `requestId` 和初始状态 | 输入文件、编码、大小、模式错误返回稳定错误 |
| `webgpt wait` | `--request-id`、可选 timeout | 返回真实 request record；timeout 不取消请求 | 未知 ID 或控制面超时返回错误 |
| `webgpt result` | `--request-id`，可选 `--out` | JSON 返回 response，或写入 UTF-8 文件并返回 hash/大小 | 结果不存在、路径越界、重复覆盖均拒绝 |

成功 CLI 进程退出码为 `0`，命令/业务错误为 `1`；`--json` 输出机器可解析 JSON。Prompt 内容不写入请求元数据 JSON，仅保存字符数和 SHA-256；完整回答存入独立 UTF-8 结果文件。

## 5. Request Lifecycle

公开状态集合：

```text
QUEUED → SUBMITTED → GENERATING → COMPLETED
                         ├──────→ FAILED
                         └──────→ TIMEOUT
USER_CONTROL → PAUSED_FOR_USER → AUTO_CONTROL → QUEUED
Workbench restart → INDETERMINATE
```

Request Manager 是唯一请求事实源。Workbench 重启后不会盲目重放未完成网页请求；用户交还自动控制权后重新读取当前页面状态，再决定是否继续。已有请求执行期间，`new-chat` / `open-chat` 被 `WEBGPT_BUSY` 保护，避免同一 Composer 并发写入。

## 6. Real Roundtrip Evidence

以下证据来自最新打包 EXE，而非静态 Mock。三轮使用同一 `workbenchInstanceId` 与同一 `webgptRuntimeId`，说明 CLI 和 GUI 复用了同一个 WebGPT Runtime；三轮使用同一实际 Chat URL。

| 轮次 | requestId | Chat URL | 期望 | 实际 | 最终状态 |
|---|---|---|---|---|---|
| 1 | `wgpt-bdf45f15-f285-4eb6-9354-95b6ea244eac` | `https://chatgpt.com/c/6a864a1e-3964-83ee-9e2f-05f34b500750` | `WEBGPT_WEB3_OK_1` | `WEBGPT_WEB3_OK_1` | `COMPLETED` |
| 2 | `wgpt-7425805c-3264-4b13-b243-b5cbd07a2e6b` | `https://chatgpt.com/c/6a864a1e-3964-83ee-9e2f-05f34b500750` | `WEBGPT_WEB3_OK_2` | `WEBGPT_WEB3_OK_2` | `COMPLETED` |
| 3（文件） | `wgpt-48620633-5ef0-4c49-bbec-6df9a3d3d113` | `https://chatgpt.com/c/6a864a1e-3964-83ee-9e2f-05f34b500750` | `WEBGPT_WEB3_FILE_OK` | `WEBGPT_WEB3_FILE_OK` | `COMPLETED` |

每轮均通过：

- `send --json` 立即返回 `QUEUED` 和 requestId；
- Request record 产生 `submittedAt` / `completedAt`，真实网页提交与完成均有持久时间证据；
- `wait --timeout-ms 120000` 返回 `COMPLETED`；
- `result --json` 读取同一 requestId 的最终回答；
- 结果文件保存了 SHA-256 和字节数；
- 第三轮使用 `codex-webgpt-web3-file-prompt.md`，验证 `.md` UTF-8 文件入口；
- `result --out` 额外写出 `WEBGPT_WEB3_FILE_OK`，JSON 返回 `outputPath/outputBytes` 而不在 stdout 中截断长结果。

最新实际身份（仅用于证据关联，不含凭据）：

```text
workbenchInstanceId: 92429e64-a25a-4167-b9ec-0ec029c3475b
webgptRuntimeId: a1fae8b7-3704-47a4-ac91-3b0c75bbd8b4
```

## 7. Completion Detection

完成判定组合使用：

- Assistant 节点数量或文本相对 baseline 发生变化；
- 页面 Composer 仍存在；
- Composer 草稿为空；
- 页面未处于 generating 状态；
- Assistant 最终文本连续 3 次采样保持稳定；
- 过滤 `正在思考`、`Thinking`、`Generating` 等页面中间态。

初次真实验证发现页面中间态“正在思考”在旧逻辑下被提前持久化为完成结果；已将中间态同时纳入 Page Probe 的 generating 判断和 Main 等待逻辑，并用单元测试覆盖。修复后重新打包的三轮真实结果均为最终文本。

## 8. GUI / CLI Same Runtime

最新包先通过 CLI 自动启动 Workbench，再执行 `open` / `control auto`；返回：

```text
ready: true
loginRequired: false
onChatPage: true
composerFound: true
mode: AUTO_CONTROL
```

CLI 三轮过程中 GUI 显示的是同一个 WebGPT 页面和同一 Session。CLI 自动启动路径在 Workbench 完全关闭后验证通过；不要求用户预先打开 Workbench。

## 9. Control Ownership

真实验证：

```text
control user → mode USER_CONTROL
send USER_CONTROL_PAUSE_TEST → PAUSED_FOR_USER
control auto → mode AUTO_CONTROL
wait same requestId → COMPLETED
result → USER_CONTROL_PAUSE_TEST
```

USER_CONTROL 下没有自动填写或提交 Prompt；交还 AUTO_CONTROL 后使用原 requestId 安全恢复，未创建替代请求或替代 Chat。

## 10. Failure Smoke

| 场景 | 真实结果 |
|---|---|
| `open-chat --url https://example.com` | exit 1，`WEBGPT_COMMAND_FAILED`，拒绝任意站点 |
| `result --request-id wgpt-does-not-exist` | exit 1，`REQUEST_NOT_FOUND` |
| `send --file` 指向不存在文件 | exit 1，`CLI_INPUT_INVALID / CLI_PROMPT_FILE_NOT_FOUND` |
| USER_CONTROL 下 send | `PAUSED_FOR_USER`，不触碰页面 Composer |
| 已有请求期间切 Chat | Main Request Manager 返回 `WEBGPT_BUSY`，不并发写 Composer |
| Workbench 重启中断状态 | 未完成请求恢复为 `INDETERMINATE`，禁止盲目重放 |
| 非 UTF-8 / 不支持扩展名 | CLI 输入校验拒绝；契约测试覆盖 |
| 页面中间态误完成 | 已真实发现并修复；修复后 3/3 roundtrip 通过 |

不破坏真实用户环境去强制制造硬崩溃、稳定 no-rollout 或 writer conflict；这些路径由既有 contract/unit/real reliability 证据覆盖。

## 11. Changed Files

### WebGPT Core / Adapter

- `src/features/webgpt/types.ts`：页面探针、异步 request record/result/state 类型。
- `src/features/webgpt/adapter/webgpt-page-adapter.ts`：页面 readiness、Composer、发送、new chat、停止/中间态探针和受限响应提取。
- `src/features/webgpt/runtime/webgpt-workspace.ts`：同一 WebContentsView 上的 create/open/send/wait/result、控制权和安全处理。
- `src/features/webgpt/runtime/webgpt-request-manager.ts`：Main-owned request queue、状态收敛、重启 indeterminate、结果持久化。
- `src/features/webgpt/index.ts`：WebGPT feature 导出边界。

### Main / CLI / Renderer

- `src/main/webgpt-command.ts`：WEB-3 命令和显式参数 allowlist。
- `src/main/webgpt-control.ts`：文件输入、长 wait socket、requestId 校验和 CLI auto-start。
- `src/main/main.ts`：Request Manager IPC/control routing、结果输出路径校验。
- `src/preload/preload.cts`：request-state 事件桥接。
- `src/renderer/renderer.ts`、`src/renderer/index.html`：当前 requestId/state 的轻量可观察投影。

### Tests

- `tests/webgpt-command.test.ts`
- `tests/webgpt-control-contract.test.ts`
- `tests/webgpt-page-adapter.test.ts`
- `tests/webgpt-request-manager.test.ts`

## 12. Test Results

```text
npm run check                 PASS
npm test                      PASS (137/137)
npm run build                 PASS
npm run package:win           PASS
npm audit --omit=dev         PASS (0 vulnerabilities)
git diff --check              PASS (仅 Git 行尾转换 warning，无 whitespace error)
secret scan                   PASS (SECRET_SCAN_CLEAN)
```

V1 real regression：

```text
npm run test:real             PASS — NATIVE_THREAD_SMOKE_OK；thread_deleted
npm run test:real:navigation  PASS
npm run test:real:workspace   PASS — interrupt / continue / same nativeThreadId
npm run test:real:multi-thread PASS — A/B completed，事件按 Thread 隔离
npm run test:real:composer-capability PASS
npm run test:real:composer-persistence PASS
npm run test:real:project-lifecycle PASS — restart same nativeThreadId
npm run test:real:reliability PASS — process exit DISCONNECTED；missing cwd classified
```

## 13. Security

- 未安装新软件、插件或浏览器驱动。
- 未读取、导出或写入 Cookie、密码、Token。
- WebGPT 页面保持 `nodeIntegration: false`、`contextIsolation: true`、sandbox。
- 远程页面不获得 Workbench preload bridge。
- 公开 CLI 只接受 allowlist command，不接受任意 JavaScript / CSS selector / DOM node。
- URL 只允许 `https://chatgpt.com` Chat 页面和受限登录 origin。
- Prompt 文件只作为 UTF-8 `.md/.txt` 文本读取，限制 2 MB。
- `result --out` 只允许 cwd、userData、系统临时目录下的安全路径，禁止覆盖既有文件。
- secret scan 未发现凭据模式。

## 14. Known Issues / Deferred

| 项目 | blocking | 说明 |
|---|---:|---|
| `new-chat` 初始 URL | NO | ChatGPT 在首条消息发送前可能停留在 `https://chatgpt.com/`；实现返回真实首页状态，不伪造 `/c/...`。首条 Prompt 提交后实际 `/c/...` URL 已被返回并持久化。 |
| 多账号 / Session 管理 | NO | 按 WEB-3 明确 deferred；当前复用单一持久 WebGPT Session。 |
| 文件附件上传 | NO | 按 WEB-3 明确 deferred；当前只支持 Prompt 文本文件。 |
| ChatGPT 私有 DOM 变化 | NO（当前） | Page Adapter 依赖可观察语义控件；页面改版时需重新执行 real smoke。 |
| 首次旧逻辑中间态误完成 | NO（已修复） | 修复已进入本阶段实现并通过 137 项测试及 3/3 真实往返。 |

## 15. V1 Core Integrity

```text
v1_core_behavior_changed: NO
v1_regression: PASS
Native Thread / Runtime / Project / Composer / Map / Manual Mode: PASS
```

WEB-3 只增加 WebGPT 一级 Feature 的 CLI/Request Manager/Page Adapter 链路，没有建立第二套 Conversation、Transcript、Task 或 Context truth，也没有改动旧 donor。

## 16. Package / Git State

最新可执行文件：

`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`

```text
outer EXE SHA256:
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```

本阶段实现基线：

```text
base_commit: 5e700c2 (WEB-2 report commit)
implementation_commit: a3af2f0
report_commit: 1c402ba (initial report commit)
package_commit: 99fbaac
```

以下用户本地资料保持原状态，未加入本阶段提交：

- `dist-stage-a/`
- `指导文档/*.docx`
- WEB-0 / WEB-2 既有 spike 文档

旧 donor `D:\办公\AI\Codex_Workbench` 与 `D:\办公\AI\Auto_Agent` 未修改。

## 17. Review Decision Request

请 GPT 按当前 V1 Frozen 原则审查本报告和配套 ZIP，并明确返回：

```text
GATE_RESULT: PASS | FIX_REQUIRED | BLOCKED
```

若 PASS，请给出下一阶段名称、目标、Scope、Gate 和可直接执行的完整指令；若 FIX_REQUIRED，仅给出 WEB-3 范围内 Gate Fix；若 BLOCKED，请说明需要用户决定的事项。
