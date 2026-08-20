# Codex Workbench WebGPT — Project-scoped CLI focused review

## 0. Review status

本文件是对当前 Project 名称 CLI 功能的聚焦审查包，不是新的产品阶段，也不扩大 V1 Frozen Core。

```text
GATE_RESULT: BLOCKED
IMPLEMENTATION_STATUS: READY_FOR_REVIEW
AUTOMATED_GATE: PASS
FINAL_REAL_PROJECT_SMOKE: NOT_COMPLETED
PROMPT_SENT_DURING_FINAL_SMOKE: NO
NEW_CHAT_CREATED_DURING_FINAL_SMOKE: NO
```

`BLOCKED` 只表示最终修复后的真实网页 Project smoke 尚未取得可复核的 PASS 证据；不能把自动化测试或修复前的 DOM 证据冒充最终 real PASS。

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
implementation_fix: d54ac32 fix: route project webgpt actions through hovered row
review_head: d54ac32
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

## 6. Real smoke evidence

### 6.1 已取得的真实页面证据

修复前的标准打包 EXE 已实际读到真实页面 DOM 结构，确认问题不是 Project 名称解析，而是页面 Project 行的 hover-revealed action 和实际点击状态没有被正确建立。该证据用于根因分析，不作为最终修复 PASS。

### 6.2 最终修复后的真实 smoke

最终修复后尝试使用干净启动的标准打包 EXE 重测。期间实际观察到：

- 页面出现 `chrome-error://chromewebdata/`；
- Workbench 返回 `WEBGPT_UNAVAILABLE` 或 Control Plane 等待/超时；
- 页面控制链路在限定等待内没有恢复到可执行的 ChatGPT Project 页面。

因此本轮没有取得最终修复路径的 `project open` PASS，也没有执行 `project new-chat`，没有发送 Prompt，也没有创建新 Chat。该项应由 GPT 审查决定后续是否在页面/网络稳定时进行一次受预算约束的人工复测。

## 7. Manual retest required

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

## 8. Review package contents

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

## 9. Package provenance

```text
package_exe: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
package_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
package_exe_status: built by npm run package:win after d54ac32
```

## 10. Workspace safety

- 本功能提交没有修改旧 donor `D:\办公\AI\Codex_Workbench`；
- `D:\办公\AI\Auto_Agent` 未修改；
- 用户已有 `dist-stage-a/`、`指导文档/*.docx`、Browser/WebGPT 历史资料和其他工作树删除状态没有纳入本包；
- 本次没有安装新软件、插件或修改系统配置；
- 没有发送真实网页 Prompt，也没有删除或修改用户现有 Chat。

## 11. Requested review decision

请审查 GPT 根据以下事实给出结论：

```text
AUTOMATED_GATE: PASS
CODE_FIX_PRESENT: YES
FINAL_REAL_PROJECT_OPEN_SMOKE: BLOCKED / NOT_COMPLETED
FINAL_REAL_PROJECT_NEW_CHAT_SMOKE: NOT_TESTED
RECOMMENDED_DECISION: BLOCKED_FOR_REAL_SMOKE_RETRY
```

当前不应返回整体 PASS；若需要继续，只应在网页控制平面稳定后，对两个 Project CLI 命令各执行一次受预算约束的真实验证，不要循环重试，也不要发送 Prompt。
