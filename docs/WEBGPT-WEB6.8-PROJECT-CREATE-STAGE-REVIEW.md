# WEB-6.8 Project Create — 阶段审查报告

## 1. Executive Summary

```yaml
stage: WEB-6.8 Project Create
result: PASS_CANDIDATE
base_commit: 3328b2f
implementation_commit: 4d8578b
fix_commit: a569ba6
v1_core_changed: NO
remote_project_registry: PASS
control_plane_command: webgpt.project.create
prompt_sent_by_create_path: NO
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

本阶段补齐了远程 WebGPT Project 的创建入口，并在最新标准打包 EXE 上完成真实 CLI 闭环：

```text
open → control auto → project create
      → duplicate guard
      → inspect → project open → project new-chat
```

真实创建只填写 Project 名称并点击“创建项目”；没有发送网页 Prompt，也没有点击全局“新聊天”。创建成功后返回并持久化了远程 Project identity。`project new-chat` 在本阶段按既有无 Prompt 契约只准备 Project Chat 上下文，返回 `awaitingFirstPrompt=true`、`chatCreated=false`，不伪造 Chat URL。

## 2. Scope Resolution

### In scope

- `webgpt project create --name <project-name> --json`。
- 版本化 Control Plane 命令 `webgpt.project.create`。
- 既有 Browser Lease / Operation Arbiter / WebGptWorkspace / Page Adapter 链路。
- 使用语义 DOM 定位 Project 区域、`新项目` 按钮、创建对话框输入框和 `创建项目` 确认按钮。
- 创建结果的远程 Project ID / URL 确认与独立 Registry 持久化。
- 同名、同 ID、同 URL 的 fail-closed duplicate handling。
- 既有 `project inspect/open/new-chat` 回归。

### Out of scope

- V1 Native Thread / Turn / Item / Runtime Registry / Conversation truth。
- 本地 Workbench Project 的 `cwd` 生命周期。
- Prompt 发送、Chat 历史管理、Project 删除/重命名/迁移/批量管理。
- Automation、Workflow、Planner、Reviewer、Scheduler、多账号。
- OCR、坐标点击、自研 Playwright/Selenium/CDP 默认实现。

## 3. Architecture Boundary

```text
V1 Frozen Core
  └─ WebGPT Feature
      ├─ CLI: webgpt project create
      ├─ Control Plane: webgpt.project.create
      ├─ Request Manager
      ├─ Browser Lease / Operation Arbiter
      ├─ WebGptWorkspace
      ├─ Page Adapter (semantic DOM only)
      └─ WebGptProjectRegistry (remote identity only)
```

远程 Project Registry 位于 `userData/webgpt/projects/projects.json`，与 V1 本地 `ProjectRecord/cwd` 分离。没有新增 Conversation、Transcript、Task 或 Automation 事实源。

## 4. Implementation

### Page Adapter 的真实 DOM 修复

真实页面取证得到：

- 项目分组标题为 `DIV.group/sidebar-expando-section-header`，子标题为 `H2.__menu-label`。
- 项目列表首次打开时先显示 loading shimmer；`open` 的 `ready=true` 不等于 Project 列表已经加载。
- 列表加载后，真实创建按钮为 `BUTTON aria-label="新项目"`。
- 创建窗口内只有一个可见输入框，但没有可靠的“项目/名称” aria-label 或 placeholder；示例 placeholder 是动态文本。
- 创建成功后页面使用真实路由 `/g/<project-id>/project`，不是旧实现假设的唯一 `/project/<id>` 路由。

对应修复：

- 只等待目标语义创建按钮出现，不重试点击、不扩大 Control Plane deadline。
- 语义匹配补充 `新项目`。
- 已确认的创建对话框内只有一个可见输入框时才使用该输入框；多个输入框则继续 fail-closed。
- 以页面实际 Project route、Project 标题/上下文和变更后的 URL 确认创建结果。
- Registry 接受并规范化 `/g/<id>/project`，同时保留既有 `/project/<id>`、`/projects/<id>` 兼容路径。
- diagnostics 只记录受限 DOM 属性和 bounded action labels，不记录页面正文、Prompt、Cookie 或 Token。

### Registry / Control Plane

- 创建前先检查 Registry；同名 create 在浏览器动作之前返回 `PROJECT_ALREADY_EXISTS`。
- 创建成功后仅写入已确认的 `projectId/name/projectUrl/timestamps`。
- `promptSent=false`、`chatCreated=false` 是创建结果的明确字段。
- 失败不合成替代 ID，不写入未确认身份，不自动重复创建。

## 5. Error Mapping

| 内部错误 | Control Plane canonical code | 语义 |
|---|---|---|
| `PROJECT_ALREADY_EXISTS` | `INVALID_ARGUMENT` | 已有同名/同 ID/同 URL，拒绝重复创建 |
| `PROJECT_CREATE_ACTION_NOT_FOUND` | `CAPABILITY_NOT_SUPPORTED` | 未发现 Project 创建动作 |
| `PROJECT_CREATE_ACTION_AMBIGUOUS` | `CAPABILITY_NOT_SUPPORTED` | 创建或确认动作不唯一 |
| `PROJECT_CREATE_SECTION_NOT_FOUND` | `CAPABILITY_NOT_SUPPORTED` | 未发现 Project 区域 |
| `PROJECT_CREATE_NOT_CONFIRMED` | `RECOVERY_REQUIRED` | 点击或结果缺少可确认身份 |
| `PROJECT_CREATE_FAILED` | `INTERNAL_ERROR` | 未分类的创建失败 |

## 6. Real CLI Smoke

所有真实 CLI 均通过 Node `child_process.execFile` 调用；没有使用 PowerShell 直接执行 EXE 命令。测试使用唯一名称：

```yaml
project_name: WEB68_PASS_1787307133490
project_id: g-p-6a8824828c248191b748e0e92b76958c
created_project_url: https://chatgpt.com/g/g-p-6a8824828c248191b748e0e92b76958c/project
prompt_sent: false

本轮真实取证过程中实际创建了两个仅用于验证的远程测试 Project，均未发送 Prompt：

```yaml
test_projects_created:
  - name: WEB68_FINAL_1787306761906
    project_url: https://chatgpt.com/g/g-6a88231622548191a8905edd08892218/project
  - name: WEB68_PASS_1787307133490
    project_url: https://chatgpt.com/g/g-p-6a8824828c248191b748e0e92b76958c/project
cleanup: NOT_PERFORMED (Project Delete 不在 WEB-6.8 scope)
```
```

| 操作 | 结果 | 关键证据 |
|---|---|---|
| `webgpt open --json` | PASS | `ready=true`，登录态可用，Composer 可见 |
| `webgpt control auto --json` | PASS | `mode=AUTO_CONTROL` |
| `webgpt project create --name ... --json` | PASS | `exitCode=0`，`created=true`，action=`新项目`，confirm=`创建项目`，`promptSent=false` |
| 同名 `project create` | PASS | `exitCode=2`，canonical=`INVALID_ARGUMENT`，`legacyCode=PROJECT_ALREADY_EXISTS`，未再次执行浏览器动作 |
| `webgpt project inspect --name ... --json` | PASS | `found=true`，`matchCount=1`，目标行 `DIV[role=button]`，hover actions 为“打开项目首页”和项目选项 |
| `webgpt project open --name ... --json` | PASS | Project 标题上下文匹配，`projectRoute=true`，Composer 可见 |
| `webgpt project new-chat --name ... --json` | PASS | `chatContextReady=true`，`awaitingFirstPrompt=true`，`chatCreated=false`，`promptSent=false` |

### Project route note

ChatGPT 在创建后实际使用 `/g/<id>/project`，随后打开同一 Project 时可能把页面 URL 展示为带名称 slug 的 `/g/<id>-<name>/project` 形式。真实 smoke 以精确 Project 名称上下文、Project route 和 Composer 绑定共同确认，没有把页面 slug 当作新的 Workbench Project identity，也没有创建替代 Project。

## 7. Automated Verification

```text
npm run check       PASS
npm test            PASS — 210/210
npm run build       PASS
npm run package:win PASS
npm audit --omit=dev PASS — 0 vulnerabilities
git diff --check    PASS
secret scan         PASS — 0 high-confidence credential pattern hits in intended source/test files
```

新增/回归覆盖：

- CLI / Control Plane create contract、参数白名单、JSON/Error Envelope。
- Page Adapter 的真实语义按钮、动态输入框、route confirmation、无正文/Prompt selector。
- Registry 创建、重开加载、名称/ID/URL duplicate、实际 `/g/<id>/project` route。
- Request Manager 创建成功、重复短路、页面失败不伪造身份、不发送 Prompt。
- WEB-6.5R、WEB-6.6、WEB-6.7 既有测试全部保持通过。

## 8. Package Provenance

```yaml
package_gui: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
package_cli: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
gui_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_sha256: D69E97ED569234C39FC7984B36FFEF6CC114E7503355CD3A7675BD5DE80B64A5
main_js_sha256: 7AD3572023D4161C4A52421BB2DDCD956D704B47DEF7795BABF404C46EAD8852
renderer_js_sha256: 94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
implementation_commit: 4d8578b
fix_commit: a569ba6
```

## 9. Subagents

| Agent | 任务 | 结果 | 状态 |
|---|---|---|---|
| Linnaeus | 调用链与 Page Adapter 审计 | 确认 CLI→Control Plane→Lease→Workspace→Adapter | 已自然完成并关闭 |
| Harvey | CLI / Control Plane 契约审计 | 确认命令白名单、错误映射和预算接入点 | 已自然完成并关闭 |
| Godel | Registry / 本地 Project 边界审计 | 确认远程 Project 不混入本地 cwd ProjectRecord | 已自然完成并关闭 |
| Erdos | WEB-6.5R / 6.6 / 6.7 回归审计 | 确认新增命令未改变既有 Role、Protocol、Presenter | 已自然完成并关闭 |

```text
running_subagents_at_gate: 0
```

## 10. V1 / Legacy / User Files

```yaml
v1_frozen_core_changed: NO
legacy_project_changed: NO
old_donor: D:\办公\AI\Codex_Workbench — 只读，既有 dirty baseline 保留
old_auto_agent: 未修改
V1docs.zip: 保持用户原状态，未加入
dist-stage-a: 保持用户原状态，未加入/修改/删除
指导文档/*.docx: 保持用户原状态，未加入/修改/删除
```

本次只提交 WEB-6.8 相关源码/测试修复和本阶段文档/审查包；不清理、不 reset、不覆盖其他用户已有 dirty 文件或历史 review 删除项。

## 11. Known Limitations

- ChatGPT Project 页面属于外部 UI；未识别的 section/action/dialog 会 fail-closed，并保留 bounded diagnostics。
- `project new-chat` 在不发送 Prompt 的前提下只准备 Project Chat 上下文；真正 Chat URL 需要用户后续发送第一条 Prompt，本阶段不伪造该身份。
- ChatGPT 可能在同一 Project 上使用不同的 URL slug；Workbench 以 Project 名称上下文和已确认 remote identity 共同保护，不把 slug 变化当作新 Project。
- 本阶段不实现 Project 删除、重命名、迁移、批量管理和多账号。

## 12. Gate

```yaml
project_create: PASS
duplicate_handling: PASS
project_registry: PASS
cli_contract: PASS
control_plane: PASS
open_regression: PASS
new_chat_context_regression: PASS
automated_tests: PASS
standard_build_package: PASS
real_project_create_smoke: PASS
real_duplicate_project_create_smoke: PASS
real_open_new_chat_smoke: PASS
v1_core_changed: NO
gate: PASS_CANDIDATE
```

本阶段完成后不自动进入 WEB-6.9/WEB-7，不自动提交 GPT；审查资料包交由用户手动提交。
