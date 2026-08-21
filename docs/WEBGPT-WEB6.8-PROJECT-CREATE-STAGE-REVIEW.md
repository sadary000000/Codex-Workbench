# WEB-6.8 Project Create — 阶段审查报告

## 1. Executive Summary

```yaml
stage: WEB-6.8 Project Create
result: BLOCKED_STANDARD_PACKAGE_LOCK
implementation_commit: 4d8578b
v1_core_changed: NO
remote_project_registry: IMPLEMENTED
control_plane_command: webgpt.project.create
prompt_sent_by_create_path: NO
next_action: 关闭正在运行的标准 Workbench EXE 后重跑标准 build/package，并执行真实 Project Create smoke
```

WEB-6.8 已完成代码实现和自动化契约验证。标准 `dist/package/Codex Workbench V1.exe` 当前被 4 个正在运行的进程锁定，标准 `npm run build` 在清理输出目录时收到 Windows `EPERM unlink`，因此本报告不把旧标准 EXE 当作本阶段包，也不虚报真实网页 Project 创建通过。

在独立临时输出目录 `dist-web68-build` 中，`npm run build` 与 `npm run package:win` 均已通过，证明本阶段源码可以编译并打包；临时输出仅用于验证，未作为标准发布包替换锁定文件。

## 2. Scope Resolution

### In scope

- 新增 `webgpt project create --name <project-name> --json` CLI。
- 新增版本化 Control Plane 命令 `webgpt.project.create`。
- 通过既有 Browser Lease / Operation Arbiter / WebGptWorkspace / Page Adapter 链路完成 Project 创建动作。
- 用语义 DOM 定位 Project 区域、创建动作、名称输入框和确认按钮。
- 只在页面返回可确认的 Project ID + Project URL 后成功。
- 远程 WebGPT Project 使用独立 Registry 持久化，并按名称、ID、URL 拒绝重复身份。
- 统一映射创建失败、重复、动作不支持和无法确认等错误。

### Out of scope

- V1 Native Thread / Turn / Item / Runtime Registry / Conversation truth。
- 本地 Workbench Project 的 `cwd` 生命周期。
- ChatGPT 页面内容读取、Prompt 发送、Chat 历史和新 Chat 创建。
- Automation、Workflow、Planner、Reviewer、Scheduler、多账号、删除/重命名/批量迁移。
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

远程 Project Registry 与本地 `V1PersistenceStore` 的 ProjectRecord 分离。远程 Project 不需要也不会伪造本地 `cwd`；本地 Project 归属、Native Thread 身份和 V1 运行事实没有改变。

## 4. Implementation

### CLI / Control Plane

- CLI parser 接受 `project create --name <name>`，仅允许 `--name` 和 `--json`。
- `WEBGPT_CONTROL_COMMANDS` 与生成的 schema 通过单一源自动包含 `webgpt.project.create`。
- Control Plane 要求 `projectName`，按命令字段白名单拒绝多余字段。
- Project Create 使用独立 90 秒服务预算和 5 秒 CLI 传输余量，沿用现有请求诊断与取消边界。

### Page Adapter

新增 `buildWebGptCreateProjectScript`：

- 先在“项目 / Projects”语义区域内检查精确同名 Project，发现已存在即返回 `PROJECT_ALREADY_EXISTS`，不点击、不创建。
- 只在该区域标题附近寻找“新建项目 / 创建项目 / New Project / Create Project”动作。
- 对话框内填入名称并触发 input/change，再点击唯一语义确认按钮。
- 仅返回受限的 action、confirm、Project ID、Project URL 和状态字段；不返回页面正文、聊天内容、Cookie 或 Token。
- 创建后缺少可确认身份、发现 ID/URL 不一致或结果超时均 fail-closed。

### Registry

新增 `src/features/webgpt/runtime/webgpt-project-registry.ts`：

- 写入 `userData/webgpt/projects/projects.json`，版本为 1。
- 使用临时文件 + rename 原子持久化。
- 只接受 `https://chatgpt.com/project/<id>` 或等价 `/projects/<id>` 路由，并 canonicalize 到 `/project/<id>`。
- 按大小写不敏感名称、Project ID、canonical URL 检测重复。
- 不保存 Cookie、Token、认证信息、页面正文或浏览器 Profile。

### Main / Request Manager

- 主进程为 WebGPT Request Manager 注入独立 Registry。
- 创建前先检查 Registry，重复名称在浏览器副作用前返回 `PROJECT_ALREADY_EXISTS`。
- 创建动作使用 `PROJECT_CREATE` Browser Lease，不会与其它浏览器操作并发。
- 远程结果确认后才写 Registry；失败不会写入替代身份，也不会重试创建。
- 返回中明确 `created: true`、`promptSent: false`、`chatCreated: false`。

## 5. Error Mapping

| 内部错误 | Control Plane canonical code | 语义 |
|---|---|---|
| `PROJECT_ALREADY_EXISTS` | `INVALID_ARGUMENT` | 已有同名/同 ID/同 URL，拒绝重复创建 |
| `PROJECT_CREATE_ACTION_NOT_FOUND` | `CAPABILITY_NOT_SUPPORTED` | 未发现 Project 创建动作 |
| `PROJECT_CREATE_ACTION_AMBIGUOUS` | `CAPABILITY_NOT_SUPPORTED` | 创建或确认动作不唯一 |
| `PROJECT_CREATE_SECTION_NOT_FOUND` | `CAPABILITY_NOT_SUPPORTED` | 未发现 Project 区域 |
| `PROJECT_CREATE_NOT_CONFIRMED` | `RECOVERY_REQUIRED` | 点击或结果缺少可确认身份 |
| `PROJECT_CREATE_FAILED` | `INTERNAL_ERROR` | 未分类的创建失败 |

## 6. Tests

自动化结果：

```text
npm run check  PASS
npm test       210/210 PASS
npm audit --omit=dev  0 vulnerabilities
git diff --check  PASS（仅有既存换行提示，无 whitespace error）
secret scan     PASS（仅命中既有 Control Plane authToken 字段定义/脱敏逻辑，无运行时凭据）
```

新增覆盖：

- CLI create 成功解析、空名称、重复 `--name`、未知参数。
- Control Plane create 解析、字段白名单和独立操作预算。
- Page Adapter 创建脚本的语义动作、重复保护、fail-closed、无正文/Prompt selector。
- Registry 创建、重开加载、名称/ID/URL 重复、非法 URL、ID/URL 一致性、原子文件不变性。
- Request Manager 创建成功、创建前重复短路、页面失败不伪造身份、不发送 Prompt。

## 7. Build / Package

### 标准输出

```text
npm run build
FAIL: EPERM unlink D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
```

已确认锁定进程：PID `21236`, `36564`, `42488`, `49592`，均为该标准 EXE。未强杀、未覆盖、未删除用户正在运行的实例。

### 独立临时输出

```text
CODEX_WORKBENCH_DIST=D:\办公\AI\Codex_Workbench_V1\dist-web68-build npm run build       PASS
CODEX_WORKBENCH_DIST=D:\办公\AI\Codex_Workbench_V1\dist-web68-build npm run package:win PASS
```

临时包路径：

```text
D:\办公\AI\Codex_Workbench_V1\dist-web68-build\package\Codex Workbench V1.exe
D:\办公\AI\Codex_Workbench_V1\dist-web68-build\package\Codex Workbench CLI.exe
```

这些临时 EXE 只证明编译/打包边界，不替代标准 `dist/package`，也未被用于声称真实网页 Gate 通过。

## 8. Real App / WebGPT Smoke

```yaml
project_create: NOT_RUN
duplicate_project_create: NOT_RUN
create_open_new_chat: NOT_RUN
prompt_sent_by_this_stage: NO
```

原因是当前标准 EXE 仍在运行且被锁定；使用旧标准实例执行会混入旧代码，不能作为 WEB-6.8 证据。没有为规避锁定而启动第二套共享用户数据实例，也没有在 ChatGPT 账户中创建未验证的 Project。

解锁后的最小真实验证顺序：

```text
关闭全部标准 Codex Workbench V1.exe
更新标准 dist/package
使用最新 EXE：webgpt control auto
webgpt project create --name <一次性唯一测试名> --json
再次执行同名 create，确认 INVALID_ARGUMENT / legacyCode=PROJECT_ALREADY_EXISTS
使用返回的 Project 身份执行 project open，再执行 project new-chat
确认全程 promptSent=false，且没有点击全局 New Chat
```

## 9. Subagents

| Agent | 任务 | 结果 | 状态 |
|---|---|---|---|
| Linnaeus | 调用链与 Page Adapter 审计 | 确认 CLI→Control Plane→Lease→Workspace→Adapter；建议独立远程 Registry | 已自然完成并关闭 |
| Harvey | CLI / Control Plane 契约审计 | 确认命令白名单、错误映射和预算接入点 | 已自然完成并关闭 |
| Godel | Registry / 本地 Project 边界审计 | 确认远程 Project 不应混入本地 cwd ProjectRecord | 已自然完成并关闭 |
| Erdos | WEB-6.5R / 6.6 / 6.7 回归审计 | 确认新增命令不应改变既有 Role、Protocol、Presenter 行为 | 已自然完成并关闭 |

```text
running_subagents_at_gate: 0
```

## 10. V1 / Legacy / User Files

```yaml
v1_frozen_core_changed: NO
legacy_project_changed: NO
old_donor: D:\办公\AI\Codex_Workbench（只读，未修改）
old_auto_agent: 未修改
V1docs.zip: 保持用户原状态，未加入
dist-stage-a: 保持用户原状态，未加入/修改/删除
指导文档/*.docx: 保持用户原状态，未加入/修改/删除
```

本阶段产品源码只新增 WebGPT Project Create 边界；已有用户 dirty baseline（旧 WEB-6.5R 文档、历史 review 删除项、规划文档和 `dist-stage-a`）未被清理或重置。

## 11. Known Limitations / Blockers

### Blocker

- 标准 `dist/package/Codex Workbench V1.exe` 被运行中进程锁定，无法完成标准 build/package 更新。
- 因此真实网页 Project Create 和 duplicate smoke 尚未执行，不能将本阶段标为最终 PASS。

### Accepted limitation for this stage

- ChatGPT Project DOM 可能随服务端 UI 改版；Page Adapter 对未识别的 section/action/dialog fail-closed，并保留受限诊断。
- 本阶段不实现删除、重命名、迁移和多账号。

## 12. Gate

```yaml
error_taxonomy: PASS
error_envelope: PASS
cli_project_create_contract: PASS
remote_registry: PASS
browser_lease_boundary: PASS
automated_tests: PASS
temporary_build_package: PASS
standard_build_package: BLOCKED_BY_RUNNING_EXE
real_project_create_smoke: PENDING
v1_core_changed: NO
gate: BLOCKED_STANDARD_PACKAGE_LOCK
```

本报告完成后不自动提交 GPT；待标准 EXE 关闭并完成真实 smoke 后再形成最终 `PASS_CANDIDATE` 审查结论。
