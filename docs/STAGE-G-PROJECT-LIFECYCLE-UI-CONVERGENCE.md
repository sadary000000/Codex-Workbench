# STAGE G — Project 生命周期 + 主界面收敛

日期：2026-08-18  
状态：Automated Gate PASS；Project lifecycle manual acceptance PASS；Native Thread ownership/safety manual acceptance PASS；UI convergence DEFERRED BY USER；Stage G PASS / FROZEN
UI convergence classification：ACCEPTED UX GAP；Deferred target：STAGE I
范围边界：本阶段已冻结；UI 深度 Polish 延后 STAGE I；不做 Map UI 产品化、Workflow、Review、Git、Browser、Multi-Agent、Prompt Templates 或磁盘文件删除。

## 1. goal

让用户可以在 Codex-shaped Workspace 中完成 Project 的日常创建/加入、重命名、打开目录和移除，同时保持 Native Thread 身份、Thread ownership、Pinned / Projects / Recent 语义和 STAGE A–F 已冻结的运行事实不变。

## 2. project identity and source-of-truth boundary

- Native Thread 是唯一对话身份；`nativeThreadId` 不因 Project 操作而创建、替换或删除。
- Native Turn / Native Item 继续是消息与运行事实。
- Project 只是 Workbench 组织/上下文元数据，不建立 Conversation、Transcript、Task 或 Agent truth。
- Project `cwd` 是身份边界：本阶段只允许编辑 display name，不提供直接改路径；重新选择另一个目录应创建/加入另一个 Project。

来源：

- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`（只读规划输入）
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`（只读规划输入）
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`（只读规划输入）
- `docs/STAGE-A-MULTI-THREAD-RUNTIME.md`
- `docs/STAGE-A-POST-ACCEPTANCE-FIX.md`
- `docs/STAGE-B-IMPLEMENTATION.md`
- `docs/STAGE-C-UI-PROJECTION-DIAGNOSTICS.md`
- `docs/STAGE-D-THREAD-TITLE-NAVIGATION-STATE.md`
- `docs/STAGE-E-THREAD-HEADER-CONVERSATION-STREAM.md`
- `docs/STAGE-F-COMPOSER-CAPABILITY-APPROVAL.md`
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`

## 3. project lifecycle

### Add / choose directory

- Renderer 通过 Main-owned `dialog.showOpenDialog({ properties: ["openDirectory"] })` 调起系统目录选择器。
- `validateProjectDirectory()` 要求绝对路径，使用 `realpath()` canonicalize，确认路径存在且为目录；失败返回明确的 required / not-absolute / not-found / not-directory 错误。
- Main 在持久化前再次校验 cwd；Renderer 的 cwd 输入为 readonly，手输完整路径不再是唯一方式。
- Persistence 继续按 canonical cwd 做重复检查；同一路径不创建第二个逻辑 Project。

### Rename

- Sidebar Project 行的“操作”菜单打开轻量 modal。
- 重命名只更新 Project display name；`cwd`、Project ID、Project Thread 和 Native identity 不变。

### Open in Explorer

- Main 使用 Project 持久化的真实 canonical cwd 调用 `shell.openPath()`。
- 路径失效或打开失败时返回明确错误；不会修改 Project metadata。

### Remove

- 操作菜单 → “移除 Project” → 明确确认 modal。
- 确认文案说明：只移除 Workbench Project，不删除本地文件/文件夹；成员 Thread 会解绑为 Standalone。
- `V1PersistenceStore.removeProject()` 在一次持久化 mutation 中删除 Project 记录，并将成员 Thread 的 `projectId` 置为 `null`；保留 nativeThreadId、cwd、标题、pin、错误、Prompt Recovery 和 Composer preference。
- 已加载的普通 `NativeThreadRuntime` 在移除前调用 `detachProjectOwnership()`，其后续 read/turn/close 不会回写旧 Project ID。
- Project Map sidecar 属于 Workbench 元数据；移除时清理本地 Map 文件和 binding，并将已移除 Project 的 Map API 收敛为 `PROJECT_NOT_FOUND`。不删除用户 Project 目录，也不调用用户 Thread `thread/delete`。

## 4. navigation and ownership

- Project Thread 仍只在 Projects 分组；Standalone Thread 仍只在 Recent；Pinned 仍是 shortcut，不改变 ownership。
- Project 移除后，同一 nativeThreadId 的投影进入 Recent，不能自动切换到其他 Thread，也不创建替代 Thread。
- Project Map maintenance Thread 继续隐藏，不进入正常 Projects / Recent；本阶段不对远端内部 maintenance Thread 做静默删除。
- Project 行采用独立 row：名称 + 可见“操作”菜单 + 新建 Thread；不再把多个交互按钮嵌在 `<summary>`。
- Project 折叠状态按 `projectId` 保留，navigation refresh 不会强制全部展开。

## 5. main UI convergence

- Conversation / Composer 共用 `--content-max-width: 900px`，宽屏不横向铺满；Assistant/Event 继续使用适合内容的较窄 rail。
- Assistant 普通正文继续无大型卡片；User 保持气泡；Tool/File/Search/Approval/Error 保留必要事件卡片。
- Ready/idle 不再以永久绿色标记 Thread；running/waiting 使用轻量 indicator，unavailable/error 保留必要警示，失败 Turn 不升级为 Thread 永久失败标签。
- Project modal、操作菜单和移除确认保持轻量，不新增 Dashboard。
- 未改变 STAGE B 的 Conversation 独立滚动、Jump to latest 和常驻 Composer 架构。

## 6. files changed

- `src/shared/project-path.ts`
- `src/shared/persistence-store.ts`
- `src/codex/native-thread-runtime.ts`
- `src/main/main.ts`
- `src/main/project-map-manager.ts`
- `src/preload/preload.cts`
- `src/renderer/index.html`
- `src/renderer/renderer.ts`
- `tests/project-path.test.ts`
- `tests/persistence-store.test.ts`
- `tests/native-thread-runtime.test.ts`
- `tests/project-map-manager.test.ts`
- `tests/project-lifecycle-ui-contract.test.ts`
- `scripts/real-project-lifecycle-smoke.ts`
- `package.json`
- `docs/STAGE-F-COMPOSER-CAPABILITY-APPROVAL.md`（修正冻结状态文案）
- 本阶段报告

## 7. tests

- `npm run check`：PASS。
- `npm test`：102/102 PASS。
- Project lifecycle contract：choose / rename / open / remove IPC 与 HTML/Renderer 对齐、readonly cwd、可见操作菜单、稳定 `data-project-id`、折叠状态保持。
- Project path：真实目录、canonical `..` 路径、相对路径、普通文件、缺失路径。
- Persistence：重命名保持 cwd，移除只解绑 ownership，nativeThreadId 与目录保留。
- Runtime：已加载 Project Runtime detach 后保持同一 Native Thread identity。
- Project Map：清理 Workbench sidecar 不触碰真实 Project 目录，已移除 Project 返回 `PROJECT_NOT_FOUND`。
- `npm run build`：PASS。
- `npm run package:win`：PASS；最新打包文件为 `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`。
- `npm audit --omit=dev`：0 vulnerabilities。
- `git diff --check`：PASS（仅有 Windows 换行转换 warning，无 whitespace error）。
- secret scan：PASS；扫描 `src`、`tests`、`scripts` 与 `package.json` 未发现高置信度 API key / private key pattern；既有 `token: "kept"` 仅为测试 fixture，不是凭据。

## 8. real smokes

- `npm run test:real:project-lifecycle`：真实临时目录、真实 Codex App Server Native Thread、真实 Turn、关闭后 restart resume 同一 nativeThreadId、Project rename、remove、Standalone projection 和目录保留。
- `npm run test:real:navigation`：PASS；重启恢复保持同一 Native Thread ID。
- `npm run test:real:workspace`：PASS；中断后继续与重启恢复通过。
- `npm run test:real:multi-thread`：PASS；两个 Thread 的 Turn 与事件标记隔离。
- `npm run test:real:composer-capability`：PASS。
- `npm run test:real:composer-persistence`：PASS。
- 本阶段新增与 A–F 真实 smoke 均使用 CLI/App Server 链路；没有把静态/contract test 冒充 Electron GUI 验收。
- 本阶段未把静态/contract test 冒充 Electron GUI 验收；用户已将 Project lifecycle / ownership / safety 聚合确认通过；UI convergence 仍明确 deferred。

## 9. manual acceptance required

用户已确认 Project lifecycle / ownership / safety 通过；以下 UI convergence 项显式 deferred，不写成 GUI 通过：

1. Project lifecycle：用户确认通过。
2. Native Thread ownership / safety：用户确认通过。
3. UI convergence：用户暂不验收，作为 ACCEPTED UX GAP 延后 STAGE I。

本记录只写用户明确确认的聚合结论；未把 UI convergence 写成 GUI PASS。

## 10. Stage A–F regression

- Stage A：多 Thread Runtime、writer conflict、orphan fail-closed、restart/reopen、Approval/Stop、active-thread truth 保持既有测试与 real smoke。
- Stage B：Conversation 独立滚动、Composer 常驻、Jump to latest 保持既有 contract 与 real workspace smoke。
- Stage C：Diagnostics 默认折叠、按 Native Thread 隔离、raw/error/source 定位保持既有 contract。
- Stage D：Thread title/displayTitle、Pinned/Projects/Recent activity indicator 不回归。
- Stage E：Header、User/Assistant、Processing、Tool/File/Search/Approval projection 不回归。
- Stage F：Model/Reasoning/Approval/Sandbox per-thread preference、Requested/Sent Diagnostics 不回归。

## 11. subagents

| agent | task | natural completion | result | adopted | validation | final status |
| --- | --- | --- | --- | --- | --- | --- |
| Franklin | Project Persistence / Identity Audit | 已自然完成 | 发现 canonical path、live Runtime stale projectId 风险 | 是 | 已补 canonical path 与 `detachProjectOwnership()`，定向测试通过 | reviewed and closed |
| Turing | Remove Project Safety Audit | 已自然完成 | 审核 remove、Map sidecar、Thread identity 与半成功风险 | 是 | Map API 缺失 Project 收敛为 `PROJECT_NOT_FOUND`；清理失败只记录 warning，不把成功操作报告为失败 | reviewed and closed |
| Bernoulli | Main UI Convergence Audit | 已自然完成 | 发现 summary 内多按钮、折叠状态重置、视觉收敛项 | 是 | Project row/menu、`data-project-id`、open state 保持与 UI contract 通过 | reviewed and closed |
| Galileo | A–F Regression Audit | 已自然完成 | A–F contracts 与打包/real smoke 验证清单 | 是 | `npm test`、check、real regression、package 在最终 Gate 记录 | reviewed and closed |

`running_subagents_at_gate: 0`

## 12. local user files and legacy project

- `dist-stage-a/`：保持用户原状态，未修改、未加入提交。
- `指导文档/*.docx`：只读使用，保持未跟踪、未修改、未加入提交。
- `D:\办公\AI\Codex_Workbench`：旧 donor 只读，保持其原有 dirty baseline，未修改。
- `D:\办公\AI\Auto_Agent`：不是产品目录，未修改。

## 13. known limitations / blockers

- 本阶段不提供 Project cwd 直接编辑；目录变更需另建/重新选择 Project，避免破坏现有 Thread ownership/recovery。
- 已登记 Project 的目录如果之后被外部移动/删除，列表不会自动创建替代 Project；Open/Create 会明确报错，必要的 unavailable Project 产品化留给后续审查。
- Project Map 本地 sidecar/binding 会清理，但不会静默调用远端 `thread/delete` 删除内部 maintenance Native Thread；该内部线程继续隐藏，远端 retire 策略不在本阶段扩大范围。
- 系统目录选择器、Explorer 打开和完整 GUI 视觉项必须由用户人工验收；CLI/contract smoke 不替代 GUI PASS。

## 14. gate

Automated Gate：PASS；Project lifecycle manual acceptance：PASS；Native Thread ownership/safety manual acceptance：PASS；UI convergence：DEFERRED BY USER / ACCEPTED UX GAP；Stage G：PASS / FROZEN；Deferred target：STAGE I。
