# STAGE I FIX — Layout / Scroll / Diagnostics / Compact Composer Audit & Fix

日期：2026-08-19  
状态：修复、自动化验证与真实 App Server 回归完成；等待用户使用最新 packaged EXE 做 GUI 验收与 GPT 审查  
base_commit：`49b8a94`（STAGE I implementation/documentation baseline）  
fix_commit：`da29164`（`fix: harden stage i responsive workspace layout`）

## 1. 审计结论

此前“代码存在 `overflow-y:auto`，所以独立滚动 PASS”的结论不成立。用户截图证明旧运行产物仍允许 page-level scroll，Sidebar 顶部和 Workspace Header 一起滚出视口。

根因是旧 artifact 没有完整包含根高度锁定；旧 `html/body/app-shell` 仍可能产生根滚动范围。同时，旧布局没有把 Diagnostics 作为 Conversation 与 Composer 之间的有界 Bottom Drawer，也没有收口窄窗口 Map/Composer 层级和 Composer hydration 状态。

本轮按真实现象反向修复。`RUNTIME_VERIFIED` 只表示源码、contract 和打包资源验证；GUI 几何与交互明确标为 `USER_REQUIRED`，不把静态测试冒充 GUI PASS。

## 2. previous claim audit

| 项目 | CLAIMED_BEFORE | ACTUAL_RUNTIME_RESULT | FIX_APPLIED | RUNTIME_VERIFIED | GUI 状态 |
| --- | --- | --- | --- | --- | --- |
| outer scroll | 有局部 `overflow-y:auto` | 截图证明 Window/Workspace 整体纵向滚动 | 锁定 `html/body/app-shell/main` 高度与 `overflow:hidden` | contract + build resource | USER_REQUIRED |
| sidebar scroll | `#navigation` 有 auto scroll | 旧 artifact 中顶部区随页面滚走 | Sidebar 高度链固定；Brand/Actions/Footer 固定；仅 `#navigation` 滚动 | contract + package resource | USER_REQUIRED：25–40 Thread |
| sidebar width | clamp 已存在 | 旧/漂移 artifact 可能仍为旧宽度；unavailable 文字形成大状态列 | 保留 220–256px clamp、row ellipsis；unavailable 改为紧凑 `!`，完整含义放 title/aria | contract + package resource | USER_REQUIRED：1600/1280/1024/800 |
| sidebar collapse | 已有 localStorage wiring | Map open + collapsed 仍保留 Sidebar 空轨道 | 增加 `sidebar-collapsed.map-open → 0 minmax(0,1fr)` | contract | USER_REQUIRED |
| workspace flex | `minmax(0,1fr)` 已存在 | 根页面滚动时 Header 仍会滚走 | `app-shell/main` 固定 viewport，Conversation 保持主滚动区 | contract + package resource | USER_REQUIRED |
| diagnostics | 独立 details，但原先位于 Composer 后 | 展开与 Composer 稳定性冲突 | DOM 调整为 `Conversation → Diagnostics → Composer`；有界向上展开，内部滚动 | contract | USER_REQUIRED |
| map overlay | 1024 以下 overlay | Map 可能遮住 Send/Stop；collapsed+map 轨道冲突 | 修正轨道规则；Map open 时 Composer z-index 7；Map 自己滚动 | contract + package resource | USER_REQUIRED |
| compact Composer | compact popover 已存在 | capability hydration 期间可能用默认偏好发送；Stop 尚无 activeTurn 时可能显示 | hydration fail-closed；Stop 只在 activeTurnId 存在时显示；form submit 保留 | contract + unit | USER_REQUIRED |
| model/reasoning | popover + per-thread preference | `跟随模型` 摘要不清晰，加载期间无保护 | 摘要明确显示 `跟随模型`；能力读取期间禁止发送 | contract + unit | USER_REQUIRED |
| access | popover + native mapping | `never + read-only` 时摘要只显示“只读” | 摘要始终同时显示 Approval 与 Sandbox | contract + unit | USER_REQUIRED |
| diagnostics isolation | per-thread log map | 异步 capability 错误可能覆盖当前 Thread 状态栏 | capability consume 显式绑定目标 ID；showError 只更新当前目标 UI | contract + unit | USER_REQUIRED：A/B |
| unavailable refresh | fail-closed | read 失败后左侧 projection 可能仍显示旧状态 | read failure 后刷新 navigation，并恢复 unavailable 错误提示 | contract + unit | USER_REQUIRED |
| textarea | max-height 已存在 | 没有自动增长 | input 按 scrollHeight 增长，最大 240px，超出内部滚动；draft 切换同步高度 | contract + build | USER_REQUIRED |

## 3. final scroll domains

允许滚动的区域只有：`#navigation`、`#thread-workspace`、`.debug-grid` 及其 raw/index 子区域、`.map-panel`、`#prompt` 超过最大高度后的内部区域。

`html`、`body`、`#app-shell`、`main` 和 Workspace outer 均固定高度并 `overflow:hidden`，不承担滚动。

## 4. implementation

### Outer Shell / Sidebar

- `html, body { height:100%; overflow:hidden; }`。
- `.app-shell { height:100vh; min-height:0; overflow:hidden; }`。
- `.sidebar` 与窄窗口 Drawer 使用明确 height、`min-height:0`、`overflow:hidden`。
- Brand、Sidebar actions、Footer 使用 `flex:0 0 auto`。
- `#navigation` 是唯一 Sidebar list scroll owner。
- unavailable Thread 用紧凑 `!` 显示，title/aria-label 保留“不可用”语义，避免形成永久大状态列。

### Workspace / Diagnostics

- `main` 使用 `height:100%`、`min-height:0`、`overflow:hidden`。
- Grid 顺序为 Header、Status、Conversation、Diagnostics、Composer；Composer 是最后一个 grid row。
- Diagnostics 收起时仅保留薄 summary strip；展开时为 `max-height:min(42vh,420px)` 的 flex Drawer，内容由 `.debug-grid` 独立滚动。
- Diagnostics 日志只有在原本接近底部时才自动跟随，用户阅读历史时不会被新事件强制拉到底部。
- Map panel 明确 width/height/overflow，不改 Map semantic/source 逻辑。

### Responsive / Map

- 1024/800 的 Map fixed overlay 不再保留 collapsed Sidebar 空轨道。
- Map 打开时 Composer 提升到 z-index 7，Send/Stop 不被 Map 遮挡。
- Sidebar 宽度继续使用 `clamp(220px,22vw,256px)`，Workspace 使用 `minmax(0,1fr)`。

### Composer Stability

- Composer capability hydration 期间加入 per-Thread loading guard，禁止已保存偏好恢复前发送第一轮。
- capability IPC 显式绑定目标 `nativeThreadId`，后台 Thread 异步错误不污染当前状态栏。
- Stop 只有目标 Thread 存在 `activeTurnId` 时显示/可用；in-flight 防重复。
- 当前 Thread 读取失败后刷新 navigation，保持 unavailable projection 与 fail-closed 状态。
- Model/Reasoning 摘要明确显示模型与“跟随模型/具体推理强度”；Access 摘要始终显示 Approval 与 Sandbox。
- textarea 按 `scrollHeight` 自动增长并限制在 240px，超过上限后内部滚动。

## 5. source of truth boundary

本轮只修改 Renderer、CSS、layout/UI state、UI contract tests；未修改 Native Thread identity、Native Turn/Item、RuntimeRegistry、App Server 协议、Approval broker、Composer Main/native mapping、preference persistence、Project ownership、Map semantic/source rules 和旧 donor。

## 6. tests and real smokes

当前定向验证：`npm run check` PASS；`npm test` PASS（113/113）；Stage I UI/layout contracts PASS（5/5）。

最终 Gate：`npm run build` PASS；`npm run package:win` PASS；`npm audit --omit=dev` PASS（0 vulnerabilities）；`git diff --check` PASS；changed-source secret scan PASS。

真实 App Server regression：navigation、workspace、multi-thread、composer capability/persistence、project lifecycle、reliability、map、resumed-map、project-map、context、map-pause 全部 PASS，最终输出 `REAL_SMOKE_MATRIX_PASS`。本轮未修改 Runtime/Main，仍执行了全量回归，不能以 Renderer 修复替代这些证据。

## 7. packaged GUI evidence

固定产物：`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`。

用户需要用重新生成的 EXE 验收：1600/1280/1024/约800px 无 page-level scrollbar；Brand/Add 固定且 25–40 个 Thread 时只有列表滚动；Conversation/Header/Composer 关系稳定；Diagnostics 收起薄、展开向上、内部滚动且不移动 Composer；Map、collapse、A/B Thread、Composer Send/Stop 正常。

Computer Use 曾连续两次捕获 Electron 窗口失败：`SetIsBorderRequired failed: 不支持此接口 (0x80004002)`。因此本报告不声称 packaged GUI PASS，GUI 标记为 `USER_REQUIRED`。

## 8. subagents

| Agent | 任务 | 结果 | 状态 |
| --- | --- | --- | --- |
| Godel | Outer Scroll / Shell Audit | 确认旧 dist artifact 漂移与根高度锁定缺口 | 已自然完成并关闭 |
| Hegel | Sidebar Runtime Layout Audit | 确认固定区、unavailable 刷新与 collapse/anchor 风险 | 已自然完成并关闭 |
| Copernicus | Diagnostics Drawer Audit | 确认 bounded height、向上展开、内部 scroll 结构 | 已自然完成并关闭 |
| Tesla | Composer Regression Audit | 发现并推动 hydration/Stop/target isolation/textarea 收口 | 已自然完成并关闭 |
| Cicero | Responsive / Map Audit | 发现 collapsed+Map 轨道与 overlay 遮挡风险 | 已自然完成并关闭 |

`running_subagents_at_gate: 0`

## 9. local / legacy status

用户本地 `dist-stage-a/`、`指导文档/*.docx` 未 add、未修改、未删除。旧 donor `D:\办公\AI\Codex_Workbench` 仅只读检查，原有 dirty 状态保留。

## 10. known limitations / blockers / gate

- 没有可用的 Electron viewport GUI harness；1600/1280/1024/800 的真实几何与交互需用户验收。
- 720px CSS Drawer 低于 Electron 当前 `minWidth:760`，约800px 是本阶段实际窄窗口目标。
- Attachment 继续 deferred/unsupported。
- 实现/自动化 Gate 无 blocker；GUI 为 `USER_REQUIRED`。
- 不进入 STAGE J。

```text
STAGE I FIX Automated Gate: PASS
STAGE I FIX Real App Server Regression: PASS
STAGE I FIX Packaged GUI: USER_REQUIRED / NOT_CLAIMED
STAGE I FIX: READY_FOR_GPT_REVIEW
STAGE J: NOT_STARTED
```
