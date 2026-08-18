# Codex Workbench V1 — STAGE B 实施报告

## status

- Automated Gate: PASS。
- Manual GUI Acceptance: PASS（用户已明确确认）。
- Stage B Status: PASS / FROZEN。

## scope_resolution

```text
STAGE B NAME: Workspace Scroll / Composer 基础
STAGE B GOAL: 将 Thread Workspace 收敛为 Header + Conversation Scroll Container + 常驻 Composer。
IN SCOPE: 主消息滚动容器、底部预留、底部跟随、用户上滚保护、Jump to latest、Composer 长对话布局契约与测试。
OUT OF SCOPE: STAGE C 诊断投影、标题/导航重做、消息视觉重做、附件/模型/权限/推理能力、Map UI、Runtime/Thread identity 架构重做。
EXPECTED PRODUCT BEHAVIOR: 任意长度 Thread 中 Composer 始终可见；无需翻到底输入；底部时跟随新输出；用户阅读历史时不抢滚动位置；可显式跳回最新。
ARCHITECTURE BOUNDARY: 只改 Renderer 布局/滚动行为和纯 UI 契约测试；Native Thread/Turn/Item 仍是唯一事实，Codex App Server 主路径与 STAGE A 不变。
GATE: 机器契约/回归与真实 Runtime smoke 完成；GUI 行为保留人工复测；提交 GPT 阶段审查。
```

正式定义来自最新的 `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`。该文档明确说明 v1.1 替代此前 v1.0 实施顺序，并将 STAGE B 定义为 Workspace Scroll / Composer 基础；未发现与 STAGE A 或 V1 架构不变量冲突。

## source_documents

- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`：正式 STAGE B 定义、Workspace 滚动规则和 Gate。
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`：Composer 位于 Codex-shaped Thread Workspace 的产品边界。
- `docs/STAGE-A-MULTI-THREAD-RUNTIME.md`：多 Thread Runtime、per-thread event/approval、writer conflict 不变量。
- `docs/STAGE-A-POST-ACCEPTANCE-FIX.md`：orphan fail-closed、restart reopen、active-thread truth 和 Composer target guard。
- `docs/PHASE-04-CODEX-THREAD-WORKSPACE.md`：现有 Renderer Workspace 的历史实现参考，不作为当前 STAGE B 定义。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：已更新当前 `STAGE A → ●`、`STAGE B → ●`，并标记 `STAGE C → ○ NOT_STARTED`。
- Git history：`e738ea3` 为用户指定的 Stage B implementation baseline；`8106551` 是之后仅修正 donor 状态描述的 docs-only commit。

## goal

修复旧 Phase 4 布局中“消息区、Jump 控件和 Composer 分列”的脆弱性，使 Composer 不随消息历史或诊断面板的内容被整体页面推出视口，并使长输出期间的阅读位置可预测。

## architecture_boundary

本阶段没有增加 Conversation、Transcript、Task、Agent 或 Context 数据源，也没有改变 Main、Preload、App Server、RuntimeRegistry、Persistence、Map 或 Thread identity。Renderer 继续从 Native `thread/read`、Native Event 和现有 Runtime 状态渲染；新增的 `workspace-scroll.ts` 只提供滚动判定纯函数。

## root_causes

1. `main` 只有 `min-height: 100vh`，未将 Workspace 固定为受控视口；展开诊断区或长内容时，外层 Grid 可能增长，Composer 的“常驻”不是结构性保证。
2. `#thread-workspace`、Jump 按钮和 Composer 原来是三个同级 Grid 行。Jump 按钮使用 `position: sticky`，显示时会改变 Conversation 的可用高度，且不绑定消息滚动容器。
3. `followLatest` 是单一 Renderer 状态；切换 Thread 后可能继承上一 Thread 的阅读状态。`renderThreadWorkspace()` 全量 `replaceChildren()` 时也没有显式恢复用户已经滚到的 `scrollTop`。

## implementation

- `main` 改为 `height: 100vh; min-height: 0; overflow: hidden`，诊断面板设置有界高度和内部滚动。
- 新增 `.workspace-conversation` 相对定位壳；Conversation 与 Jump 控件同处一个受控区域；Composer 保持为其外部独立 Grid 行。
- `#thread-workspace` 明确使用 `overflow-y: auto`、`overflow-x: hidden` 和独立底部 padding；最后一项不与 Composer 重叠。
- Jump 控件改为相对 Conversation 壳的绝对定位，避免显示/隐藏改变消息视口高度；跳转使用即时滚到底部，避免平滑滚动期间误触发“离开底部”。
- 新增 `resetWorkspaceScroll()`：显式切换/新建/进入不可用状态时回到底部跟随，避免跨 Thread 继承历史阅读状态。
- 重绘前保存 `scrollTop`；非跟随状态在下一帧恢复并限制到新的最大滚动位置，跟随状态才滚到最新。
- 新增 `isNearLatest()` 纯函数，统一 80px bottom threshold，避免在 Renderer 中散落判定逻辑。

## files_changed

- `src/renderer/index.html`
- `src/renderer/renderer.ts`
- `src/renderer/workspace-scroll.ts`
- `tests/workspace-scroll.test.ts`
- `tests/workspace-layout-contract.test.ts`
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`
- `docs/STAGE-B-IMPLEMENTATION.md`

## active_thread_truth

未改变 selected/runtime/native identity 逻辑。Thread 切换时只重置当前 Workspace 的滚动状态，不修改 `nativeThreadId`，不创建替代 Thread，不把后台 Thread 的事件映射到当前 Conversation。

## composer_send_guard

未改变现有 `requestedThreadId == selectedThreadId == runtimeThreadId` 且 Runtime 为 `READY` 的 Composer send guard。Composer 只是从 Conversation scroll container 外部渲染；发送仍沿用现有 Main/Renderer 双重 fail-closed 校验。

## native_identity_preserved

本阶段没有写入 Native Thread、Native Turn、Native Item、binding、projection 或 Map store；所有 Native identity 保持原值。

## stage_a_regression

- RuntimeRegistry 仍按 `nativeThreadId` 隔离；不同 Thread 的后台 Runtime 不因 Renderer 布局改变而关闭。
- live event、Approval、Stop 和 Composer target 仍使用目标 Thread 隔离。
- writer conflict、orphan `no rollout found`、restart/reopen retry 和 active-thread truth 代码未改动。
- 既有单测与本轮 `test:real:navigation`、`test:real:workspace`、`test:real:multi-thread` 均回归通过。

## tests

- `npm run check`：PASS。
- `npm test`：PASS，73/73。
- 新增 `workspace-scroll.test.ts`：4 个滚动判定用例 PASS。
- 新增 `workspace-layout-contract.test.ts`：3 个 HTML/CSS/Renderer contract 用例 PASS。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：PASS。
- changed-file secret scan：PASS，未发现高风险 token/private-key 模式。
- `npm run build`：最终 PASS；用户关闭锁定进程后默认 `dist` 输出已重新生成。
- `npm run package:win`：最终 PASS；当前统一产物为 `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`。打包脚本会先重新 build，再覆盖生成该路径下的 EXE。
- 此前一次默认 build 的 Windows `EBUSY` 已确认是运行中 packaged EXE 的文件锁；关闭进程后重跑 build/package 已通过。

## real_appserver_smoke

本阶段只改 Renderer，但按范围要求继续执行 Runtime 回归，未将其冒充 GUI 验收：

- `npm run test:real:navigation`：PASS；Project Thread / Standalone Thread 切换与 restart 同一 Native Thread 通过。
- `npm run test:real:workspace`：PASS；interrupt → continue → restart 后 `restartNativeThreadId` 与原 Thread 相同。
- `npm run test:real:multi-thread`：PASS；两个 Native Thread 并行完成，事件 marker 按 Thread 分离。

## manual_acceptance_required

状态：PASS。以下 5 项结果均由用户完成 GUI 验收并明确确认；这里只记录用户已验证的事实，不将 CLI/静态 contract 结果替代人工验收：

1. 长 Thread 中 Composer 始终可见，消息区独立滚动，不必翻到历史底部才能输入。
2. 位于底部时继续输出自动跟随；主动上滚阅读历史时继续输出不抢位置。
3. 上滚后 Jump to latest 显示，点击后回到底部并恢复跟随。
4. 切换 A/B Thread 后各自从最新位置开始，A 的输出不会改变 B 的滚动位置。
5. Composer 调整到较高高度、展开 Native Runtime 调试区时，Composer 仍可用，Conversation 不发生外层页面滚动。

以上 5 项均已 PASS；Stage B 不再有待完成的人工验收项。

## subagents

- agent: Popper (`01a012d1-111a-7ab3-86fc-9c1e9eeef177`)
  - task: 只读核对 v1.1 Workspace Scroll / Composer 与当前 DOM/Renderer 差距。
  - natural_completion: completed，自然返回，未修改文件。
  - result: 识别旧 Jump 独立 Grid 行、平滑滚动状态抖动和重绘 scrollTop 丢失风险。
  - adopted: 是；采用 wrapper、即时 Jump 和显式位置恢复。
  - validation: 结论与源码和 v1.1 规则逐项核对。
  - final_status: completed。
  - closed_after_result: yes。
- agent: Volta (`01a012d1-2800-7461-8a28-03c2cf22206a`)
  - task: 只读核对 Stage A 回归不变量和 STAGE B 测试边界。
  - natural_completion: completed，自然返回，未修改文件；执行的 `npm run check` PASS。
  - result: 确认 Runtime/identity/target/orphan/writer-conflict 边界未被本阶段改动；指出没有 GUI 自动化，不应宣称 GUI PASS。
  - adopted: 是；纳入回归证据与人工验收限制。
  - validation: 本 Agent 结果与主 Agent 的 73/73、真实三项 smoke 和 diff 审查交叉核对。
  - final_status: completed。
  - closed_after_result: yes。

## local_uncommitted_user_files_status

- `V1docs.zip`：保持用户原状态，未 add、未修改。
- `dist-stage-a/`：保持用户原状态，未 add、未修改。
- `指导文档/*.docx`：保持用户原状态，未 add、未修改。

## legacy_project_status

- `D:\办公\AI\Codex_Workbench`：只读检查；保留原有用户 dirty baseline，未修改、未 reset、未 clean、未 stash、未 commit。
- `D:\办公\AI\Auto_Agent`：只读检查，保持 clean；未修改。

## base_commit

`e738ea3`（用户指定的 STAGE B implementation baseline；`8106551` 为之后仅修正 donor 状态描述的 docs-only commit）。

## implementation_commit

`4a0000d feat: implement stage b workspace scroll composer`

## scope_boundary

本阶段完成后停止，不进入 STAGE C；不重做 RuntimeRegistry、Navigation、Map、Approval、Composer capability、Project lifecycle 或任何新的一级产品层。

## known_limitations

- 没有引入 Electron/浏览器自动化依赖；本阶段 GUI 结果以用户人工验收为准，静态 contract 和 CLI smoke 不替代人工 GUI PASS。
- 如果再次在 EXE 运行期间打包，Windows 可能重新返回 `EBUSY`；需先关闭正在运行的 packaged EXE，再执行 build/package。
- Stage B 不处理 Stage A 已冻结的 writer-conflict 对话文案/重试入口，也不扩展附件、Model、Reasoning、Permission 等能力。

## blockers

none。自动化 Gate、真实 Runtime smoke 和用户 5 项 GUI 人工验收均已完成。

## gate

PASS / FROZEN
