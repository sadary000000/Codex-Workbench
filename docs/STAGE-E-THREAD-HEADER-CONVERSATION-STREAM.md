# Codex Workbench V1 — STAGE E

## official_stage_name

`Thread Header + Conversation Message Stream`

## freeze_status

- Automated Gate: PASS
- Manual GUI Acceptance: PASS（用户已明确确认 `STAGE E Manual Acceptance: PASS`）
- Stage E Status: PASS / FROZEN
- Stage F: 已获授权进入实现；本报告不补写未由用户逐项提供的人工观察。

## scope_resolution

```text
GOAL: 将 Thread Workspace 的默认展示收敛为 Codex-shaped 主工作区，同时继续以 Native Thread/Turn/Item 为唯一运行事实。
IN SCOPE: Thread Header 产品化、User/Assistant 层级、Thinking/Processing、Command/Tool、File、Search/Web、Approval 卡片、Turn failed/interrupted/reconnect 内联状态、Unknown Native Item 安全降级。
OUT OF SCOPE: STAGE F Composer Capability、Model/Reasoning/Permission/Attachment 新接入、Project lifecycle、Map UI、深度 Visual Polish、Workflow、Review、Git Workbench、Browser、Multi-Agent 产品层。
EXPECTED PRODUCT BEHAVIOR: 默认 UI 面向用户展示可读标题、正文和紧凑事件摘要；技术细节按需进入展开区或 Developer/Diagnostics；切换 Thread 后只显示该 Native Thread 的真实 stream。
ARCHITECTURE BOUNDARY: Renderer 只做纯 UI projection；Native Thread 是唯一身份，Native Turn/Item 是消息和运行事实，Codex App Server 是 Runtime 主路径。
GATE: 自动化、真实 App Server 回归和源代码边界检查完成；等待 GPT 审查与用户人工 GUI 验收；不进入 STAGE F。
```

## source_documents

- 用户最新正式执行指令：`C:\Users\sadar\.codex\attachments\67d1664d-4898-4e55-a01e-6a1f03837c32\pasted-text.txt`。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`：只读规划输入，未加入 Git。
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`：V1 边界输入，未修改。
- `docs/STAGE-D-THREAD-TITLE-NAVIGATION-STATE.md`：Stage D PASS/FROZEN 证据。
- `docs/STAGE-C-UI-PROJECTION-DIAGNOSTICS.md`、`docs/STAGE-B-IMPLEMENTATION.md`、`docs/STAGE-A-MULTI-THREAD-RUNTIME.md`、`docs/STAGE-A-POST-ACCEPTANCE-FIX.md`：冻结能力与回归边界。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：当前路线图。

## stage_d_freeze

- Stage D implementation/base: `bbd1140`。
- Stage D freeze commit: `c6d81a9`。
- 用户已明确确认 `STAGE D Manual Acceptance: PASS`。
- 本轮已在 Stage D 报告记录 Automated Gate: PASS、Manual GUI Acceptance: PASS、Stage D Status: PASS / FROZEN。

## architecture

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → 唯一消息与运行事实
Codex App Server → Runtime 主路径
Renderer projection → 只负责默认 UI 层级、摘要、展开详情和 source anchors
```

没有新增 Conversation truth、Transcript truth、Assistant message cache、Task truth、Agent lifecycle truth、Context truth 或 Exec history reconstruction。`message-projection.ts` 是纯函数投影层，不持久化运行事实。

## header

- 保留 Thread 可读标题、Project/Standalone 上下文和必要 cwd 提示。
- READY/COMPLETED、Turn/Item ID、完整 `nativeThreadId` 和 Runtime implementation details 不进入默认 Header；异常只显示必要的用户级状态。
- Developer/Diagnostics 仍保留完整技术信息；Thread title、selected/runtime/composer target 和 Map source 未改变。

## user_message

Native user item 投影为明确的 User 层级和右侧轻量气泡，支持换行和长文本；默认不显示 Native Turn 标题、Item ID 或大型调试卡。

## assistant_message

Native assistant item 投影为自然正文，使用 typography/spacing 建立层级，不用大面积调试卡包裹普通回答；原始 Native metadata 不进入默认正文。

## thinking_processing

真实 processing/agent message 只显示轻量 `Thinking…` 指示，不生成或泄露隐藏 reasoning；无 Runtime detail 时不伪造 elapsed/reasoning 内容，完成后自然收束。

## command_tool

Command/tool 事件默认显示类型、简洁动作、状态和有界摘要；真实 input/output/result/error/raw detail 放在 collapsed details 中，避免完整 stdout 默认铺满 Conversation。默认保留 `data-native-turn-id` / `data-native-item-id` source anchors。

## file_events

File 事件显示文件名/路径、动作和简洁摘要，并按需展开真实 details；没有借此创建 Git/diff 第二产品。当前 projection 对真实 `path`/`name`/`summary` 等字段做安全摘要，未知字段保持可追溯。

## search_web

Search/Web 事件默认显示搜索、打开页面或获取结果的紧凑摘要；真实 query、URL/domain 和摘要按需展开，不默认铺完整抓取 payload。

## approval

保持现有 Native Approval broker、IPC 和 per-thread 隔离不变。本阶段只收敛视觉：Approval 卡片位于对应 Turn（无法匹配时回退到当前 stream 末端），动作使用现有原生 broker，accept/reject 后状态由真实事件收束，不增加第二套权限协议。

## turn_state

- failed：在对应 Turn 内显示简洁用户级失败提示，完整错误继续进入 Diagnostics；Thread 不永久变成 failed。
- interrupted：在对应 Turn 内显示已中断，Thread 可继续。
- reconnect/timeout/process exit：沿用现有 Runtime recovery/error 事实，在当前 Thread 内联提示，不覆盖标题、不创建替代 Thread。

## unknown_item

未支持的 Native Item 安全降级为 generic event；默认只显示 `Unsupported Native Event: <method/type>` 的简洁摘要，raw 原始字段放在展开详情中，Workspace 不因未知事件崩溃，也不猜测其语义。

## default_ui_noise

默认 UI 不显示完整 `nativeThreadId`、Turn/Item ID 文本、raw JSON、协议枚举或完整错误对象。技术信息没有被删除，仍可在 Developer/Diagnostics、展开详情和 source trace 中查看。Header runtime pill 默认隐藏，仅在运行、确认、启动、断开、恢复或操作失败等用户可理解状态时显示。

## diagnostics_boundary

Stage C Diagnostics 保持完整：Native ID、Turn/Item IDs、raw `thread/read`、raw events、error objects 和 source anchors 仍可定位。Stage E 只改变默认 UI projection，不建立第二 Transcript，也不删除事实层信息。

## source_anchor_regression

User、Assistant、Processing、事件卡和 Turn 容器继续保留 `data-native-turn-id`、`data-native-item-id`，并以不可聚焦的 DOM 锚点参与 Map/source jump；本阶段未改 Map UI 或 Map store 规则。

## multi_thread_isolation

Renderer 按当前 Native Thread 的 read model 和 per-thread event projection 渲染；未引入全局消息缓存。Stage A 的 RuntimeRegistry、events、Approval、Stop、writer conflict、orphan fail-closed 与 restart/reopen 路径未改动，A/B Thread 的正文、事件、状态、Header 和 Diagnostics 继续按 Native ID 隔离。

## files_changed

- `src/renderer/message-projection.ts`：新增纯投影 helper，覆盖 read item/live event/turn state。
- `src/renderer/renderer.ts`：接入 User/Assistant/Processing/事件卡/Approval/Turn 状态/header runtime projection。
- `src/renderer/index.html`：Thread Header、消息层级、紧凑事件卡、details、Approval 和状态样式。
- `tests/message-projection.test.ts`：覆盖各 Native Item 类型、摘要/详情、状态与 unknown 降级。
- `tests/workspace-layout-contract.test.ts`：增加 Stage E 默认 UI、source anchor 与 Stage B 布局契约。
- `docs/STAGE-D-THREAD-TITLE-NAVIGATION-STATE.md`：记录 Stage D PASS/FROZEN。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：D → ●、E → ◉、F → ○。
- `docs/STAGE-E-THREAD-HEADER-CONVERSATION-STREAM.md`：本阶段报告。

未修改旧 donor、Native protocol、RuntimeRegistry、Map UI/store、用户本地规划文档或 `dist-stage-a/`。

## stage_a_regression

代码未触碰 Stage A Runtime/IPC/Registry/Approval/Stop/identity 关键路径。串行真实 smoke 覆盖 multi-thread event 隔离、writer/reopen 相关既有边界；projection 保留 Native ID source anchors。

## stage_b_regression

固定 Header、Conversation 独立滚动、Composer 常驻、底部跟随、上滚保护和 Jump to latest 的布局契约未改变；新增样式未把 Composer 放回 Conversation 滚动容器。

## stage_c_regression

默认 UI 隐藏协议噪声，Developer/Diagnostics 仍能查看原始信息；按 Thread 隔离的 diagnostics/source trace 与 raw error 路径未改动。

## stage_d_regression

继续使用 Stage D 的 `displayTitle → Native title → deterministic fallback` 语义；Header 仅增加上下文和必要异常投影，不改 title persistence、rename IPC、nativeThreadId 或左侧导航 ownership。

## tests

- `npm run check`：PASS。
- `npm test`：88/88 PASS。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：PASS；仅有 Windows 换行转换提示，无 whitespace error。
- changed source/test secret scan：未发现凭据、Token、Cookie 或密码。
- `npm run build`：标准构建尝试受当前用户运行中的 `dist\\package\\Codex Workbench V1.exe` 文件锁阻止（EBUSY）；使用独立临时 dist 目录执行同一 build 流程，`BUILD PASS`。

## real_appserver_smoke

以下命令在 `D:\办公\AI\Codex_Workbench_V1` 串行执行，均 PASS：

- `npm run test:real:navigation`：真实 Project/Standalone Thread 创建、切换、重启恢复和事件归属通过。
- `npm run test:real:workspace`：真实 interrupt → continue → `thread/read` → restart/reopen 同一 Native ID 通过。
- `npm run test:real:multi-thread`：两个真实 Native Thread 并行完成，A/B event markers 按 Thread 隔离。

之前把三个 smoke 并行启动时出现过首个 Turn `failed`；串行重跑全部通过，未作为产品失败结论，也未把并行失败冒充 PASS。没有稳定可复现的真实 Approval/command/file/search 专项 smoke，因此这些类型由 contract/unit tests 和用户 GUI 验收覆盖，不虚构真实触发证据。

## manual_acceptance_required

Codex 只列清单，不把 CLI/static test 冒充 GUI PASS。用户需在最新构建中复测：

1. Header 第一眼只看到标题和必要上下文，不像 Native 调试器。
2. User 消息呈右侧气泡或明确用户层级。
3. Assistant 普通回答是自然正文，不是大卡片。
4. Thinking/Processing 轻量，且不泄露隐藏 reasoning。
5. Command/Tool 默认紧凑，可展开真实 input/output。
6. File/Search 事件紧凑且位置自然。
7. Approval 卡片清楚、动作自然、完成后收束。
8. Turn failed/interrupted 只影响对应 Turn，不污染 Thread。
9. A/B Thread 同时运行时所有事件不串线。
10. 长对话 scroll、Jump to latest、Composer 不回归。
11. Diagnostics 仍可查看被隐藏的 Native details。
12. Map source jump 仍能定位正确 Turn/Item。

## subagents

所有子代理均已自然完成、返回并在审核后关闭；Gate 前 `running_subagents=0`。

| agent | task | natural_completion | result | adopted | validation | final_status | closed_after_result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Nietzsche (`01a013a6-77dd-7f13-9b91-b48d13803464`) | Native Item/event → Renderer projection audit | yes | 确认 read/event 字段和投影缺口；建议补齐状态、file/search、Turn/approval 字段 | yes | `message-projection` tests、check、test | completed | yes |
| Bohr (`01a013a6-7872-7c72-82fd-ad4cf1c76853`) | Header/User/Assistant/tool/file/search/composer/scroll UI audit | yes | 确认 Codex-shaped 层级与 Stage B 布局边界 | yes | workspace layout contract、GUI checklist | completed | yes |
| Helmholtz (`01a013a6-7946-7661-bf39-2a7172bcbf29`) | 独立 UI/runtime audit | yes | 错误审计了旧 Auto_Agent worktree，结论不适用于 V1 | no | 主 Agent 复核路径后拒绝采用 | completed | yes |
| Herschel (`01a013a6-7a0e-74d3-a1c9-2d06395a20ec`) | Stage A/B/C/Map/scroll/source-anchor regression audit | yes | 确认保留主滚动容器、Composer、source anchors、Map jump 和隔离边界 | yes | workspace layout contract、真实 smoke | completed | yes |

## local_user_files_status

- `dist-stage-a/`：保持原状态，未 add、未修改、未删除。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`：保持原状态，未 add、未修改。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`：保持原状态，未 add、未修改，仅作规划输入。
- `V1docs.zip`：未 add、未修改。

## legacy_project_status

`D:\办公\AI\Codex_Workbench` 仅作只读 donor 核对，未 reset、clean、stash、checkout、format 或 commit；`D:\办公\AI\Auto_Agent` 未修改。

## scope_boundary

本阶段只完成 Header 与 Conversation Message Stream 默认投影；不进入 STAGE F，不实现 Composer Capability、模型/权限/附件、Project lifecycle、Map UI、Workflow、Review、Git Workbench、Browser 或 Multi-Agent 产品层。

## known_limitations

- 没有自动化 Electron GUI 驱动；本报告不宣称 Stage E 人工 GUI PASS。
- 标准 packaged build 目前被用户正在运行的正确 EXE 锁定；独立临时 dist build 已通过。关闭 EXE 后可重新生成固定位置的 `dist\\package\\Codex Workbench V1.exe`。
- 没有稳定真实 Approval/command/file/search 专项 smoke；按正式指令保留 contract/unit + 用户人工验收。

## blockers

无产品代码 blocker；等待 GPT 审查和用户人工 GUI 验收。标准 build 的文件锁是当前用户运行态限制，不通过强制关闭进程解决。

## gate

`PASS / FROZEN`

Stage E 已由用户完成 GUI 验收并明确确认通过；本报告仅冻结该结论，不补写未由用户确认的逐项人工观察。Conversation Map 已进入 Stage F 实现状态。
