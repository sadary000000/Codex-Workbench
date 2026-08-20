# Codex Workbench WebGPT — Project-scoped CLI focused review

## 0. Review status

本文件是对当前 Project 名称 CLI 功能的聚焦审查包，不是新的产品阶段，也不扩大 V1 Frozen Core。

```text
GATE_RESULT: PASS
IMPLEMENTATION_STATUS: FOCUSED_FIX_COMPLETE
AUTOMATED_GATE: PASS
PROJECT_OPEN_REAL_SMOKE: PASS_SETTLED
PROJECT_NEW_CHAT_REAL_SMOKE: PASS_SETTLED
PROMPT_SENT_DURING_FINAL_SMOKE: NO
NEW_CHAT_CREATED_DURING_FINAL_SMOKE: YES_PROJECT_SCOPED_NO_PROMPT
```

本轮 focused fix 已修复 Project 行动作选择和运行时收口：真实 DOM 中项目行悬停后显示的铅笔按钮（`aria-label="打开项目首页"`）是 Project 作用域的新 Chat 入口，三个点按钮（`打开 <name> 的项目选项`）只是项目菜单。最终 create 路径只使用前者，禁止全局 New Chat 和三个点菜单；inspect 只返回受限的 Project 行/容器/悬停控件元数据。稳定会话中的真实 EXE smoke 已通过；冷启动立即执行时仍可能先出现一次 WebView `ERR_CONNECTION_CLOSED (-100)`，该现象单独记录为启动网络就绪时序限制，随后在同一稳定会话复跑通过，不作为 selector 或 Project context 失败。

`PASS` 表示稳定态 Project CLI 真实闭环已经通过：Project route/context、Composer 和行内铅笔来源均有结构化证据；没有发送 Prompt，也没有触发全局 New Chat。

## 1. Scope

本次聚焦能力：

```text
webgpt project open --name <project-name> [--json]
webgpt project new-chat --name <project-name> [--json]
```

目标是通过现有 WebGPT Control Plane 和现有 Electron WebContentsView，在 ChatGPT 页面中按精确 Project 名称打开 Project，并在该 Project 的悬停行内触发新建 Chat。

明确不包含：

- 不新增 Browser UI、Automation Service、Workflow 或 Verifier；
- 不使用 Playwright、Selenium、CDP 自研方案；
- 不修改 Native Thread / Project / Composer / Map 的 V1 事实模型；
- 不提交网页 Prompt，不创建或删除用户 Chat；
- 不保存 Cookie、账号信息、网页正文或日志；
- 不修改旧 donor `D:\办公\AI\Codex_Workbench`。

## 2. Input / implementation commits

```text
feature_base: 4b97c3c feat: add project-scoped webgpt cli navigation
implementation_fix: 8e15807 fix: close web5 project cli dom gate
review_head: 8e15807
```

`4b97c3c` 建立 Project CLI 链路；`d54ac32` 针对真实页面中“项目操作按钮只有鼠标悬停后出现”的行为修正点击路径，并增加对应 contract 断言。

## 3. Root cause evidence

在最终修复前使用标准打包 EXE 对真实 ChatGPT 页面做只读 Project 探测时，精确匹配到 `workts` 的一个 Project 候选，但页面仍停留在首页，探测结果为：

```json
{
  "matchCount": 1,
  "active": false,
  "contextMatch": false,
  "projectRoute": false,
  "targetTag": "DIV",
  "targetRole": "button",
  "parentAttributes": {
    "class": "group/project-unfurl-row relative"
  },
  "targetAttributes": {
    "aria-expanded": "false"
  }
}
```

这与用户提供的截图一致：Project 行的编辑/新建对话操作在悬停后才显示。仅派发普通合成鼠标事件不能可靠建立页面框架需要的 hover/focus 状态，因此旧路径即使找到 Project 名称，也不能证明 Project 已真正打开。

## 4. Implementation changes

### 4.1 Project open

- 精确匹配 Project 名称，不使用模糊文本命中；
- 对候选行执行 `focus()` 和受限的 hover/pointer 事件序列；
- 对页面实际候选元素调用原生 `target.click()`；
- 通过 URL、active 属性或 Project 上下文 heading 的 `contextMatch` 进行二次确认；
- 返回有界的候选/目标属性和上下文证据，不返回 `document.body.innerText`。

### 4.2 Project new-chat

- 先确认目标 Project，再只在该 Project 行、父行或祖父行范围内查找新建 Chat 操作；
- 支持页面可观察的有限语义标签，包括 `new chat`、`new conversation`、Project/Chat 组合标签及中文新建对话标签；
- 找不到或匹配多个动作时 fail-closed，返回明确错误，不调用全局 New Chat；
- 对 row/action 同样执行 focus、hover 事件和原生 click；
- 新建后等待稳定 Composer 与 Project 上下文；
- 首条 Prompt 尚未发送时，如果页面还没有 `/c/<id>` 路由，返回 `chatUrl: null`，不伪造 Chat URL。

### 4.3 CLI / runtime boundary

- 继续复用现有 `webgpt-command` → `webgpt-control` → Main dispatch → `WebGptWorkspace` 链路；
- zero-layout CLI WebContentsView 在执行页面脚本前确保存在可用 viewport；
- 保留 ChatGPT/登录来源 allowlist、sandbox、contextIsolation、无 preload bridge 等现有边界；
- `nativeThreadId`、V1 Conversation/Transcript/Task 事实源均未引入或重建。

## 5. Automated evidence

以下均在 `d54ac32` 最终修复后完成：

| Check | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 162/162 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS — 无 whitespace error |
| changed TS/test secret scan | PASS — 无匹配 |
| generated page scripts parse check | PASS — `new Function(script)` |

新增/更新的 contract 重点覆盖：

- Project 名称精确匹配；
- `focus`、`pointerover`、`mouseenter` 等悬停路径；
- 原生 `target.click()`；
- Project 行范围内的新建 Chat 动作；
- 找不到动作时 `PROJECT_NEW_CHAT_ACTION_NOT_FOUND`；
- `contextMatch` 证据；
- 不读取或返回页面全文。

## 6. Focused Gate Fix — Control budget and structured timeline

本轮只做无 Prompt 的 Project CLI 控制面修复和真实验证，不创建 Chat、不修改网页已有 Chat，也不发送网页 Prompt。

### 6.1 Implementation boundary

变更集中在：

- `src/features/webgpt/runtime/webgpt-operation-budget.ts`：Project open/new-chat 的服务端操作预算和 CLI deadline；
- `src/features/webgpt/runtime/webgpt-workspace.ts`：deadline、自动化 epoch 取消、`webContents.stop()`、阶段时间线和 fail-closed；
- `src/main/webgpt-control.ts`：Project CLI 专用响应等待预算和 `CONTROL_RESPONSE_TIMEOUT`；
- `src/main/main.ts`：请求、handler、operation、response-write 的时间线关联；
- `scripts/real-webgpt-project-cli-smoke.ts`：四条无 Prompt 命令的完整 stdout/stderr/JSON/退出码采集；
- 对应 page adapter、request manager、contract tests。

预算为：

```text
project open:    operation 60,000 ms / CLI 65,000 ms
project new-chat: operation 90,000 ms / CLI 95,000 ms
```

操作超时会推进 control epoch、停止挂起导航，并返回结构化 `CONTROL_OPERATION_TIMEOUT`；客户端 deadline 超时返回结构化 `CONTROL_RESPONSE_TIMEOUT`。时间线只包含请求和阶段元数据，不包含 Cookie、Token、Prompt、页面正文或截图。

### 6.2 Exact no-Prompt sequence

```text
webgpt status --json
webgpt control auto --json
webgpt project open --name "workts" --json
webgpt project new-chat --name "workts" --json
```

本序列的 `new_real_prompt_count` 为 `0`。

### 6.3 Structured real observations

在 Workbench 已就绪、页面为真实 ChatGPT 首页的运行中序列：

| Command | Result | Exit | Elapsed | Evidence |
|---|---|---:|---:|---|
| `status --json` | structured response | 0（CLI 外层曾受启动子进程句柄影响延迟返回） | 180,030 ms outer / 232 ms inner | `workbench=STARTING`, `webgpt=UNAVAILABLE` |
| `control auto --json` | PASS | 0 | 169 ms | `AUTO_CONTROL` |
| `project open --name workts --json` | FAIL | 1 | 12,401 ms | `PROJECT_NAVIGATION_NOT_CONFIRMED`, `matchCount=1`, `active=false`, `contextMatch=false`, `projectRoute=false`, URL 仍为 `https://chatgpt.com/` |
| `project new-chat --name workts --json` | FAIL prerequisite | 1 | 10,310 ms | 同一 Project open 前置确认失败，未执行行内新建动作 |

上述 Project open 响应已经是可解析的结构化 JSON，并包含 `handlerStartAt`、`operationStartAt`、`operationBudgetMs`、lookup start/end、click result、navigation confirmation start/end、operation finish、response write、CLI receive/exit 和 elapsed 信息。该结果不再归类为 `NO_USABLE_RESPONSE` 或页面/网络泛化错误。

之后一次冷启动/当前页面检查得到的独立分类为：

- 当前页面不含精确目标 `workts` 时，返回 `PROJECT_NOT_FOUND`、`matchCount=0`；当时可见的是 `works`，没有替换目标；
- 冷启动链路曾返回结构化 `WORKBENCH_START_TIMEOUT`（约 15,088 ms 内部等待，CLI 外层约 30,040 ms）以及一次 `CONTROL_RESPONSE_TIMEOUT`（65,000 ms），说明 CLI 自动启动 GUI 的子进程句柄生命周期仍需单独审查；这不是 Project selector PASS 证据；
- 手动启动本标准 EXE 后，EXE 能正常驻留并生成 Electron 主/GPU/renderer 进程；测试进程已清理。

### 6.4 Current real-gate interpretation

根因分层如下：

1. **已修复**：Project 长操作与 15 秒通用 Control timeout 不匹配；现在服务端操作预算、客户端 deadline、取消和时间线已对齐。
2. **仍未闭环**：真实页面中精确匹配的 Project 行点击后只观察到行状态变化/展开，未取得 active、Project context heading 或 Project route 的任一确认，因此返回 `PROJECT_NAVIGATION_NOT_CONFIRMED`；不能继续触发全局或其它 Project 的新建 Chat。
3. **独立已知问题**：冷启动时 GUI 子进程/CLI 外层句柄生命周期尚未取得稳定 PASS 证据，需后续单独审查，不能与 Project 页面失败混为一谈。

因此当前结论为 `FIX_REQUIRED`，不是整体 PASS，也不是旧版 `NO_USABLE_RESPONSE`。

## 7. Real smoke evidence

### 7.1 已取得的真实页面证据

修复前的标准打包 EXE 已实际读到真实页面 DOM 结构，确认问题不是 Project 名称解析，而是页面 Project 行的 hover-revealed action 和实际点击状态没有被正确建立。该证据用于根因分析，不作为最终修复 PASS。

### 7.2 最终修复后的真实 smoke

本轮 focused sequence 已实际调用 `project open` 和 `project new-chat`，但前者返回 `PROJECT_NAVIGATION_NOT_CONFIRMED`，后者因同一前置失败而未进入行内 action。当前没有取得最终修复路径的 Project PASS，没有发送 Prompt，也没有创建新 Chat。冷启动超时另以 `WORKBENCH_START_TIMEOUT` / `CONTROL_RESPONSE_TIMEOUT` 记录，不覆盖真实 Project 结果。

## 8. Manual retest required

在 ChatGPT 页面和登录状态稳定时，使用同一个标准 EXE，逐步执行：

```text
"D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe" webgpt status --json
"D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe" webgpt control auto --json
"D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe" webgpt project open --name "workts" --json
"D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe" webgpt project new-chat --name "workts" --json
```

验收重点：

1. 返回的 Project 名称和页面上下文均为 `workts`；
2. 不能只看到候选命中，必须看到 active/context/project route 的真实证据；
3. 新建 Chat 动作只能来自 `workts` 的悬停行，不能触发全局新建对话；
4. 页面不稳定、需要登录或出现控制平面错误时立即停止，不发送 Prompt、不重复重试；
5. 首条 Prompt 前 `chatUrl: null` 是允许的，不能据此伪造 Chat ID。

## 9. Review package contents

ZIP 只包含本功能审查所需的报告、实现源文件和测试文件，不包含 EXE、Cookie、账号资料、网页内容、日志、用户规划附件或旧项目文件。

```text
docs/WEBGPT-PROJECT-CLI-STAGE-REVIEW.md
src/features/webgpt/adapter/webgpt-page-adapter.ts
src/features/webgpt/runtime/webgpt-request-manager.ts
src/features/webgpt/runtime/webgpt-workspace.ts
src/features/webgpt/types.ts
src/main/main.ts
src/main/webgpt-command.ts
src/main/webgpt-control.ts
tests/webgpt-command.test.ts
tests/webgpt-control-contract.test.ts
tests/webgpt-feature-contract.test.ts
tests/webgpt-page-adapter.test.ts
package.json
tsconfig.json
scripts/build.mjs
scripts/package-win.mjs
```

## 10. Package provenance

```text
package_exe: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
package_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
package_exe_status: built by npm run package:win after 8e15807
```

## 11. Workspace safety

- 本功能提交没有修改旧 donor `D:\办公\AI\Codex_Workbench`；
- `D:\办公\AI\Auto_Agent` 未修改；
- 用户已有 `dist-stage-a/`、`指导文档/*.docx`、Browser/WebGPT 历史资料和其他工作树删除状态没有纳入本包；
- 本次没有安装新软件、插件或修改系统配置；
- 没有发送真实网页 Prompt，也没有删除或修改用户现有 Chat。

## 12. Requested review decision

请审查 GPT 根据以下事实给出结论：

```text
AUTOMATED_GATE: PASS
CODE_FIX_PRESENT: YES
PROJECT_OPEN_REAL_SMOKE: FAIL / PROJECT_NAVIGATION_NOT_CONFIRMED
PROJECT_NEW_CHAT_REAL_SMOKE: FAIL_PREREQUISITE / NOT_ENTERED
NEW_REAL_PROMPT_COUNT: 0
RECOMMENDED_DECISION: FIX_REQUIRED_FOR_PROJECT_REAL_GATE
```

当前不应返回整体 PASS；后续只应在 GPT 审查后，针对真实目标 Project 重新确认页面状态并修复/验证 Project route/context，不能循环重试，不能用其它 Project 替换 `workts`，不能发送 Prompt。

## 13. Final DOM gate evidence — supersedes historical failure record

本节是当前最终取证，supersede 前文关于 Project CLI 未通过的历史运行记录；历史记录保留用于说明根因和冷启动限制，不再代表当前 Gate。

### 13.1 Settled real EXE smoke
```text
EXE: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
RUN: 2026-08-20T10:07:51.762Z - 2026-08-20T10:07:53.196Z
COMMANDS: status → control auto → project inspect → project open → project new-chat
INVOCATION: each EXE command was launched by Node execFile in scripts/real-webgpt-project-cli-smoke.ts
RESULT: all five invocations exitCode=0; stderr empty; newPromptCount=0
```

`project inspect --name workts --json` returned `found=true`, `ambiguous=false`, `matchCount=1`. The bounded DOM evidence was:

```json
{
  "row": { "tag": "DIV", "role": "button", "ariaExpanded": "false" },
  "container": { "tag": "DIV", "className": "group/project-unfurl-row relative" },
  "hoverActions": [
    { "tag": "BUTTON", "ariaLabel": "打开项目首页" },
    { "tag": "BUTTON", "ariaLabel": "打开 workts 的项目选项", "ariaExpanded": "false" }
  ],
  "buttonCount": 3,
  "linkCount": 0
}
```

第一个悬停控件是用户指出的项目行铅笔/新建对话入口；第二个是三个点项目菜单，本路径从未点击。inspect 不点击，只返回受限 DOM 元数据，不返回页面正文。

`project open --name workts --json` 通过：`matchCount=1`、`contextMatch=true`、`projectRoute=true`、URL 进入 `/g/g-...-workts/project`，且 `composerFound=true`。

`project new-chat --name workts --json` 通过：

```text
chatCreated: true
chatUrl: null
promptSent: false
actionSource: project-row-new-chat-pencil
actionLabel: 打开项目首页
contextMatch: true
projectRoute: true
composerFound: true
globalNewChatClicked: false
```

`chatUrl: null` 是有意保持的：本操作只进入 Project 作用域的空白 Chat 上下文，未发送首条 Prompt，因此不伪造 `/c/...` 对话 ID。

### 13.2 冷启动限制单独记录

重新打包 EXE 后立即启动并立刻执行同一序列时，首个 `inspect` 和 `open` 曾返回真实 `ERR_CONNECTION_CLOSED (-100)`，属于 WebView 首次网络就绪时序；未增加重试、刷新或 Prompt。保持同一 EXE 会话稳定后再次执行，五步序列全部通过。该限制不改变 DOM action 结论，也未造成全局 New Chat 点击或 Prompt 发送。

### 13.3 Final decision

implementation_commit: 8e15807
package_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
resource_hashes: main.js=245AA10BE927DE1AEE911E1A98AB09865B3ACBD528103A653AC7CCF2CB8EBA93; renderer.js=94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1; package.json=1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```text
dom_inspect: PASS
project_open: PASS
project_new_chat: PASS
prompt_sent: NO
global_new_chat_clicked: NO
tests: PASS
remaining_blocker: none for the focused DOM gate; cold-start WebView readiness is recorded as a non-selector limitation
```
