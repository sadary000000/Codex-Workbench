# STAGE I — App Shell / Sidebar / Workspace / Compact Composer 优化

日期：2026-08-19  
状态：Automated Gate PASS；Manual GUI Acceptance PASS；STAGE I PASS / FROZEN
base_commit：`39484c5`（STAGE H reliability gate）  
implementation_commit：`3a06289`（`feat: refine app shell and compact composer`）

manual_gui_acceptance：用户明确确认“STAGE I FIX 测试通过”；本报告不补充未经用户陈述的逐项 GUI 观察。

## 1. scope resolution

正式阶段名称：`STAGE I — App Shell / Sidebar / Workspace / Compact Composer 优化`

目标：

- 收敛 Sidebar 宽度和 Thread row 信息密度，让 Workspace 保持主宽度拥有者。
- 为 Sidebar、Conversation、Map/Diagnostics 保持独立滚动职责。
- 将 Composer 改为输入区 + compact toolbar；Model/Reasoning 与 Approval/Sandbox 分别进入 compact popover。
- 在中等和窄窗口中提供 Sidebar 退让/折叠路径，避免 Workspace 被固定左栏压缩。
- 保留 STAGE A–H 的 Runtime、Native identity、滚动、Diagnostics、Composer capability 和 Project ownership 不变量。

本阶段不做：

- Runtime / RuntimeRegistry / App Server 协议 / Native Thread identity / Project Map 语义重构。
- Workflow、Review、Git、Browser、Multi-Agent、Attachment 假实现或新的 Transcript/Conversation truth。
- 像素级 Codex 复制；title bar、图标全量替换、字体和动画精调留待后续视觉工作。

预期行为：

```text
受控 Sidebar + flexible Workspace
→ Sidebar navigation 独立滚动
→ Conversation 独立滚动且 Composer 常驻
→ Composer 单容器、compact settings、Send/Stop 单动作位
→ 1024px 及以下 Map 退让为 overlay
→ 窄窗口 Sidebar 可折叠
```

架构边界：

- 变更集中在 `src/renderer/index.html`、`src/renderer/renderer.ts` 和 UI contract tests。
- `ResizeObserver` 只负责响应式宽度变化后的 Renderer scroll anchor 修复，不建立新的运行事实。
- Native Thread → Native Turn/Item → Codex App Server 仍是唯一产品/运行事实链路。

来源文档：

1. 用户提供的 `STAGE I 唯一执行指令`（App Shell / Sidebar / Workspace / Compact Composer 优化）。
2. `docs/STAGE-H-RELIABILITY-REGRESSION-ACCEPTANCE.md`。
3. `docs/WORKBENCH-V1-CONVERSATION-MAP.md`。
4. 本地规划输入：`指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`、`v1.2.docx`（只读，未纳入 Git）。

## 2. implementation

### App Shell / Sidebar

- 使用 `--sidebar-width: clamp(220px, 22vw, 256px)`，主列继续使用 `minmax(0, 1fr)`。
- Sidebar 的 `#navigation` 使用 `flex: 1 1 auto`、`overflow-y: auto`、`overflow-x: hidden`，Footer 不参与列表滚动。
- Thread 标题保留 `min-width: 0`、ellipsis；Pin 默认不占固定操作列，仅在 hover/focus/selected 时出现。
- Project/Thread row 增加 `min-width: 0`，Project 菜单保留既有“操作” contract。
- 新增 `toggle-sidebar` / `sidebar-close`；折叠状态以 Renderer UI localStorage 保存并恢复，不影响 Thread identity 或 Project ownership。
- 导航重绘保留 `#navigation.scrollTop`，避免运行状态刷新时左栏跳回顶部。

### Responsive / Workspace / Map

- `max-width: 1100px` 时 Map 改为 fixed overlay，避免 1024px 主区被 328px Map 列压窄；Diagnostics grid 同时收敛为单列。
- `max-width: 720px` 时 App Shell 单列，Sidebar 作为可收起 Drawer，Composer toolbar 和 popover 适配窄宽度。
- Map panel 具备独立纵向滚动；Composer popover 的 z-index 高于 Map overlay，避免设置菜单被遮挡。
- Conversation 继续是 `#thread-workspace` 唯一主滚动区；Sidebar/Map 不抢 Conversation scroll。
- Conversation `ResizeObserver` 在 Sidebar/Map/窗口改变宽度后恢复底部跟随或保留用户阅读位置。

### Compact Composer

- 删除永久四列 `.composer-options` 和重复“发送消息”文案；textarea 使用 `发送消息…` placeholder。
- Model + Reasoning 保留原有四个 select/Native binding，但放入 `composer-model-menu` popover；summary 显示当前模型和推理强度。
- Approval + Sandbox 放入 `composer-access-menu` popover；Access summary 同时反映“需批准/不请求审批”和“项目可写/只读”。
- `#start-turn` 和 `#interrupt-turn` 共用同一 action slot，通过 `hidden` 在 idle/running 间切换；Stop 请求增加 in-flight 防重复点击。
- Composer 改用 form-level `submit` 处理发送，按钮点击和键盘提交共用一条路径。
- `effort=null` 显示明确的“跟随模型”选项；不改变真实 Native request mapping。
- 技术 helper 默认隐藏；unsupported saved value 或 capability discovery 失败时显示必要的 fail-closed 状态。
- capability discovery 失败且存在旧 model/effort 时直接禁用 Send，避免未经验证的设置进入 `turn/start`；无旧设置时仍允许纯文本路径。
- Diagnostics 继续位于 Composer 之后的独立 `<details>`，未嵌入 Composer。

### Files changed

- `src/renderer/index.html`
- `src/renderer/renderer.ts`
- `tests/stage-i-ui-contract.test.ts`
- `docs/STAGE-I-APP-SHELL-COMPACT-COMPOSER.md`
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`

## 3. contract tests

新增 `tests/stage-i-ui-contract.test.ts`，覆盖：

- 受控 Sidebar + flexible Workspace grid、collapse state。
- Sidebar 独立滚动、Thread title ellipsis、hover/selected actions、响应式 1100/720 breakpoints。
- Map scroll、popover overlay 层级、Composer popover/label/type/hidden contract。
- Diagnostics 与 Composer 分离。
- Renderer sidebar localStorage/aria wiring、form submit、Send/Stop 显隐、ResizeObserver、capability fail-closed 状态。

## 4. STAGE A–H regression

- Native Thread identity、RuntimeRegistry、A/B isolation、Stop/Approval/writer conflict/orphan/reopen 路径未修改。
- STAGE B Conversation scroll / Jump to latest / Composer 常驻结构保留；响应式宽度变化新增 scroll anchor 补偿。
- STAGE C Diagnostics 默认关闭、Thread/Turn/Item/raw/source trace 保留。
- STAGE D/E Thread title、message projection、Map source anchor 保留。
- STAGE F Model/Reasoning/Approval/Sandbox per-Thread preference 和 fail-closed validation 保留。
- STAGE G Project lifecycle/ownership 未修改。
- STAGE H 仍为 Automated/Real Gate PASS、Manual Functional Acceptance DEFERRED/PENDING；本报告不将其写成最终人工 PASS。

## 5. tests / real App Server smoke

自动化 Gate：

| 命令 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，113/113 |
| STAGE I UI contract | PASS，5/5 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS |
| changed-source secret scan | PASS，`SECRET_SCAN_PASS` |

真实 smoke：

- `npm run test:real:navigation`：PASS；Project/Standalone ownership、切换、restart same ID。
- `npm run test:real:workspace`：PASS；interrupt/continue/restart same ID。
- `npm run test:real:multi-thread`：PASS；A/B output/event isolation。
- `npm run test:real:composer-capability`：PASS；真实 model/effort，Approval manual trigger 仍按限制记录。
- `npm run test:real:composer-persistence`：PASS；A/B preference persistence。
- `npm run test:real:project-lifecycle`：PASS；Project cwd、restart same ID。
- `npm run test:real:reliability`：PASS；process exit/disconnected、same ID reopen、missing cwd。
- `npm run test:real:map`：PASS；dynamic Map patch。
- `npm run test:real:resumed-map`：PASS；compatibility fallback、same Native Thread。
- `npm run test:real:project-map`：PASS；member/maintenance isolation、restart revision/cursors。
- `npm run test:real:context`：PASS；bounded context response。
- `npm run test:real:map-pause`：PASS；paused dirty、resume cursor/revision。

打包基线：

- [Codex Workbench V1.exe](D:/办公/AI/Codex_Workbench_V1/dist/package/Codex%20Workbench%20V1.exe)
- 固定路径：`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`
- 文件大小：225,441,792 bytes
- SHA-256：`31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`
- 已检查 packaged `resources/app/dist/renderer/index.html` 包含本阶段 Sidebar/Composer 结构。

## 6. manual GUI acceptance

用户明确确认：`STAGE I FIX 测试通过`。以下保留原人工验收范围作为可追溯清单，不将其扩写为新的逐项观察。

未将 CLI/static smoke 冒充 GUI PASS。用户使用最新固定路径 EXE 时需重点检查：

1. 1600/1280/1024/约800 窗口宽度下 Sidebar 不异常撑宽，Workspace 仍为主区域。
2. 左栏 `Projects/Recent` 有独立滚动，滚动不影响 Conversation。
3. 长 Thread title ellipsis；Pin/Project 操作不长期占列宽。
4. 约800px 下可收起左栏，Conversation/Composer 仍可用。
5. 长对话 Conversation scroll、Jump to latest、Composer 常驻不回归。
6. Composer 总高度明显下降，只看到输入区 + Model/Reasoning + Access + Send/Stop。
7. 点击 Model/Reasoning 与 Access 可看到真实动态 options；A/B Thread 偏好不串。
8. idle 显示 Send，running 只显示同一位置的 Stop；键盘提交不重复发 Turn。
9. unsupported/capability failure 时提示清楚且 Send fail-closed。
10. Diagnostics 默认隐藏、展开后仍独立滚动；Map 打开时不遮挡 Composer popover，source jump/anchors 正常。
11. A/B multi-thread、Approval、Stop、restart/reopen、Project lifecycle、Map source trace 保持既有人工验收结论。

当前环境没有可用的 Electron viewport GUI harness；Windows Computer Use 曾连续两次返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)`。这不改变用户已经给出的阶段级人工结论；本报告不补充额外逐项 GUI 观察。

## 7. subagents

| Agent | 任务 | 自然完成与结果 | 采用情况 |
|---|---|---|---|
| Erdos | App Shell / Sidebar audit | 只读完成；指出 Sidebar/map/overflow/scroll 风险 | 采用受控宽度、独立滚动、min-width、nav scroll 保留 |
| Curie | Composer capability audit | 只读完成；指出 form submit、effort follow、capability fail-closed、Stop 防双击风险 | 已采用对应最小修复 |
| Raman | Responsive / regression audit | 只读完成；指出 1024 Map diagnostics、overlay 层级、resize anchor 风险 | 已采用 1100 overlay、z-index、ResizeObserver |
| Banach | UI contract audit | 只读完成；指出需要覆盖 sidebar/Composer/responsive/diagnostics contracts | 已新增并增强 `stage-i-ui-contract.test.ts` |

所有子代理均自然运行到完成、主 Agent 审核并整合结果后关闭；没有子代理写入共享工作树。

`running_subagents_at_gate: 0`

## 8. local / legacy status

用户本地规划资料保持原状态，未 add/modify/delete：

- `dist-stage-a/`
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`

旧 donor `D:\办公\AI\Codex_Workbench` 继续只读，未 reset、clean、stash、checkout、format 或 commit。

## 9. known limitations / blockers / gate

已知限制：

- 当前没有 Electron/viewport 自动化 harness；1600/1280/1024/约800 和窄窗口仍需用户用固定 EXE 做 GUI 验收。
- 720px CSS Drawer 分支低于当前 Electron `minWidth: 760`，可通过虚拟 viewport/后续 GUI harness 验证；约800px 仍覆盖本阶段实际目标。
- 视觉结果以 Codex Desktop 原生布局方向为参考，但不宣称像素级一致。
- Attachment 仍 deferred/unsupported。

blockers：none for implementation/automated Gate；manual GUI acceptance pending by user。

```text
STAGE H Automated/Real Gate: PASS
STAGE H Manual Functional Acceptance: DEFERRED/PENDING BY USER
STAGE I Automated Gate: PASS
STAGE I Manual GUI Acceptance: PASS (user-confirmed)
STAGE I: PASS / FROZEN
STAGE J: IN_PROGRESS
```
