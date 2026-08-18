# Codex Workbench V1 — STAGE C 阶段报告

日期：2026-08-18  
官方阶段名称：`UI Projection / Diagnostics 分层`  
基线：`26652c9 docs: freeze stage b after manual acceptance`

## 1. scope_resolution

```text
STAGE C NAME: UI Projection / Diagnostics 分层
STAGE C GOAL: 默认产品界面隐藏协议噪声，并提供按需、可定位、与 Native 事实一致的 Developer / Diagnostics 入口
IN SCOPE: Renderer presentation projection、Developer / Diagnostics panel、Native field display separation、unit/contract tests
OUT OF SCOPE: RuntimeRegistry、App Server、IPC protocol、Thread identity、Navigation ownership、Composer target、Conversation Map 规则、Project lifecycle，以及 STAGE D/E/F 的产品能力
EXPECTED PRODUCT BEHAVIOR: 默认 Thread Workspace 面向用户展示对话内容；打开 Developer / Diagnostics 后可定位真实 Thread/Turn/Item、thread/read 原始快照、原始事件/操作日志和错误详情
ARCHITECTURE BOUNDARY: Native Thread/Turn/Item 和 RuntimeSnapshot 继续是唯一事实；Renderer 只做展示投影和临时诊断缓存，不建立 Diagnostics Store、Transcript 或 Conversation 第二事实源
MANUAL ACCEPTANCE: 见第 10 节；本报告不把 CLI/静态测试写成 GUI 人工 PASS
GATE: 默认 UI 无协议噪声；Diagnostics 可定位 Native 对象和原始信息；A/B、orphan、restart、Composer、Map source jump、Approval、Stop、STAGE B 滚动无回归
```

范围来自最新本地规划文档，未发现无法消解的实质冲突，因此按用户指令继续实现。历史 Phase C / P9-C / APP-SERVER-EVAL-01 未被当作本阶段定义。

## 2. source_documents

- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`：本地未提交规划输入，未修改、未加入 Git。
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`：V1 范围和冻结边界。
- `docs/STAGE-A-MULTI-THREAD-RUNTIME.md`：STAGE A Runtime、Thread 隔离和恢复基线。
- `docs/STAGE-A-POST-ACCEPTANCE-FIX.md`：orphan fail-closed、restart/reopen 和 active-thread truth 基线。
- `docs/STAGE-B-IMPLEMENTATION.md`：STAGE B Workspace Scroll / Composer 实现与验收证据。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：开发路线和阶段状态，已在本轮更新 STAGE C。
- `git log`：从 `26652c9` 向前核对 STAGE B freeze、STAGE A fix 与 Runtime 隔离提交。

## 3. goal

STAGE C 将“协议事实”和“用户默认界面”分层：普通 Thread Workspace 不再把完整 Native ID、Turn/Item 标识、原始 JSON、协议级状态和原始错误当作主界面内容；开发者仍可通过明确打开的 `Developer / Diagnostics` 查看和定位真实运行信息。

## 4. architecture_boundary

- `Native Thread → Native Turn → Native Item` 仍是唯一对话、消息和运行事实。
- `RuntimeSnapshot`、`ThreadReadView.raw`、Native event 的 bounded/raw 字段继续来自现有 Runtime/App Server 链路。
- `src/renderer/ui-projection.ts` 只包含标签、状态和错误的展示映射；不改变 Native 值，不创建协议适配层。
- Renderer 的 `diagnosticsLogsByThread` 和错误缓存只存在于当前窗口内，用于按 `nativeThreadId` 隔离展示，不持久化、不成为 Conversation/Transcript truth。
- 消息卡片继续保留隐藏的 `data-native-turn-id` / `data-native-item-id` DOM 锚点，供 Diagnostics 定位和 Map source jump 使用；ID 只在显式诊断入口展示。
- 未修改 RuntimeRegistry、App Server client/protocol、IPC contract、Navigation ownership、Composer target guard、Approval/Stop、Map store/rules 或 Project lifecycle。

## 5. files_changed

- `src/renderer/ui-projection.ts`：新增展示标签、Runtime 状态、操作状态和用户友好错误映射。
- `src/renderer/index.html`：默认 Header/Composer/状态文案降噪；新增折叠的 Developer / Diagnostics 入口、Runtime 定位、thread/read 原始快照、Thread/Turn/Item 定位和原始事件日志区域。
- `src/renderer/renderer.ts`：接入展示投影；隐藏默认协议元数据；按 Native Thread 隔离诊断日志；保留真实 DOM 锚点和 Map source jump；错误失败后继续保留不可用 Thread 的诊断 ID/错误，同时 Composer 保持 fail-closed。
- `tests/diagnostics-projection.test.ts`：新增默认 UI 降噪、诊断入口、定位锚点、按 Thread 诊断缓存和错误映射契约测试。
- `docs/STAGE-C-UI-PROJECTION-DIAGNOSTICS.md`：本阶段报告。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：更新 STAGE B/STAGE C/STAGE D 阶段状态和当前范围。

未修改：Runtime、Main/Preload IPC、Native protocol、Map store、旧 donor 和用户本地规划文件。

## 6. implementation

### 默认界面投影

- Header 只显示对话标题/类型和中文化 Runtime 状态，不显示完整 `nativeThreadId`。
- Turn/Item 卡片默认显示用户可读的 User、Assistant、Thinking / Processing、Command / Tool、File Change、Web / Search 等标签，不显示 `#itemId`、Turn ID、状态原文或每卡 raw JSON。
- 系统型后台 Native event 不进入默认消息流，但仍进入按 Thread 隔离的 Diagnostics 日志。
- Composer 去除 `Native Turn`、`Transcript` 等协议提示；实际发送仍使用现有 selected/runtime/requested Thread 一致性校验。
- App Server/JSON-RPC/协议错误默认显示简短可行动文案，完整错误对象仍写入 Diagnostics。

### Developer / Diagnostics

- 入口默认折叠，显式打开后可查看 `nativeThreadId`、`activeTurnId`、`localRunId`、cwd、最近错误和 `thread/read` 原始快照。
- 提供当前 read model 的 Turn/Item 定位按钮，点击后滚动并聚焦真实消息卡片。
- 原始事件/操作日志按 `nativeThreadId` 分桶，A/B Thread 切换时不会把另一 Thread 的日志显示到当前 Thread。
- orphan/invalid Thread 在切换失败后不恢复为可发送状态；诊断区仍保留失败 Thread ID、错误和对应日志，默认消息区明确提示不可用。
- 既有 `data-native-turn-id` / `data-native-item-id` 锚点保留，Conversation Map source jump 继续命中原始消息卡片。

## 7. stage_a_regression

- 全量单元测试包含 STAGE A 相关的 multi-thread、writer conflict、orphan、restart/reopen、active-thread/composer target 测试：通过。
- `npm run test:real:navigation`：PASS；真实创建 Project/Standalone Thread、切换、重启恢复和 completed event 归属均保持。
- `npm run test:real:workspace`：PASS；真实 interrupt → continue → restart 后同一 `nativeThreadId` 保持，Turn 状态和事件归属正确。
- `npm run test:real:multi-thread`：PASS；两个 Native Thread 并行完成，A/B event marker 分离。
- 本阶段未改 Runtime、IPC、Approval、Stop 或 Thread identity 代码。

## 8. stage_b_regression

- 全量测试中的 workspace layout/follow/jump-to-latest 契约通过。
- `npm run test:real:workspace` 真实验证通过；Composer 与 Thread workspace 的 Runtime 主链未改变。
- Conversation 仍是独立滚动区域，Composer 仍常驻；本阶段只调整可见文案和新增折叠诊断区域，没有改变 Stage B 的滚动结构。
- 用户已确认的 STAGE B 五项 GUI 结果继续作为人工验收基线，本报告不重新宣称 GUI PASS。

## 9. tests

以下均在 `D:\办公\AI\Codex_Workbench_V1` 执行：

- `npm run check`：PASS。
- `npm test`：76/76 PASS。
- `node --experimental-strip-types --test tests/diagnostics-projection.test.ts`：3/3 PASS。
- `npm run build`：PASS（`BUILD PASS`）。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：PASS；仅报告现有 Windows CRLF 转换提示，无 whitespace error。
- secret scan：PASS；新增/修改 Renderer 和测试文件未命中常见 token/private-key/password/api-key 模式。

## 10. real_appserver_smoke

- `npm run test:real:navigation`：PASS；输出 `NAVIGATION`，包含两个 Project Thread、一个 Standalone Thread、切换顺序、重启恢复 ID 和四个 completed events。
- `npm run test:real:workspace`：PASS；输出 `WORKSPACE_SMOKE`，同一 `nativeThreadId` 完成 interrupted/continued Turn 并在 restart 后恢复。
- `npm run test:real:multi-thread`：PASS；输出 `STAGE_A_MULTI_THREAD`，两个 Thread 的 Turn 均 completed，A/B event marker 分离。
- 本阶段只改 Renderer 展示层，没有新增或伪造 App Server smoke；以上是真实 App Server 回归结果，不是 GUI 自动化结果。

## 11. manual_acceptance_required

以下项目需要用户人工打开构建后的应用确认，本报告不把它们写成已通过：

1. 默认 Thread 页面不显示完整 Native Thread ID、Turn ID、Item ID、raw JSON 和协议级状态。
2. 展开 `Developer / Diagnostics` 后能找到当前 Thread/Turn/Item、最近错误、thread/read 原始快照和原始事件日志；点击定位能回到对应消息。
3. A/B Thread 切换后 Diagnostics 日志、定位对象和 Composer 实际目标不串线。
4. 对 orphan、writer conflict、restart/reopen 错误，默认 UI 清楚提示；不可用 Thread 不能发送，也不能 fallback 到其他 Thread；诊断区仍可查到真实 ID/错误。
5. Conversation Map source jump 仍能到达原始 Turn/Item。
6. Approval、Stop、STAGE B Conversation 滚动、底部跟随、Jump to latest 和 Composer 输入行为保持正常。

## 12. subagents

| agent | task | natural_completion | result | adopted | validation | final_status | closed_after_result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dirac (`01a01301-8cc3-7403-899a-1b175ea9c9f9`) | 只读核对最新规划、阶段边界和冲突 | 已自然完成并返回 | 确认 v1.1 对 STAGE C 的定义唯一；最新 DOCX 是未提交本地规划输入 | 是 | 与主 Agent 的 scope resolution 和阶段文档交叉核对 | completed | yes |
| Kierkegaard (`01a01301-8f94-7dc2-85aa-363ac8087934`) | 只读审计 Renderer/UI projection 差距 | 已自然完成并返回 | 确认默认界面暴露 Native 元数据；现有 read model/raw/DOM anchor 足够支撑分层，无需 Runtime/IPC 改造 | 是 | 逐文件审阅 `index.html`、`renderer.ts`、`thread-read-model.ts`；新增 contract tests | completed | yes |
| Socrates (`01a01301-924b-7be3-83d9-eb3dbb2fe6c4`) | 只读审计 STAGE A/B 回归和测试边界 | 已自然完成并返回 | 要求保留 DOM Native 锚点、Composer fail-closed、A/B event/approval 隔离、Map source jump 和 Stage B scroll 行为 | 是 | 全量测试、三组真实 smoke、diff/check | completed | yes |

本阶段子代理未修改产品文件，未触碰旧 donor；Gate 前运行中的子代理为 0。

## 13. local_user_files_status

- `V1docs.zip`：保持未提交、未修改、未加入 Git。
- `dist-stage-a/`：保持用户原状态，未修改、未加入 Git。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`：保持未提交、未修改、未加入 Git；仅作为规划/参考输入读取。

## 14. legacy_project_status

旧 donor `D:\办公\AI\Codex_Workbench` 仅做只读状态核对，保持用户原有 dirty baseline，未 reset、clean、stash、checkout、format、commit 或修改。旧 `D:\办公\AI\Auto_Agent` 也未修改。

## 15. known_limitations

- 本阶段没有自动化 GUI 驱动；默认 UI、折叠诊断入口和点击定位仍需人工验收。
- Diagnostics 日志是当前 Renderer 会话内的 bounded projection，不是持久化日志库；事件日志保留上限为 120,000 字符。
- 原始信息来自现有 bounded Native event/read model；没有扩大 App Server wire buffer，也没有实现完整历史重建。
- Stage D 的标题/左侧导航完整改版、Stage E 的消息视觉重做、Stage F 的 Model/Reasoning/Permission/Attachment 能力均未实现。
- 本阶段不新增 packaged EXE；GUI 验收应使用用户已有构建流程生成的当前应用。

## 16. blockers

none。

## 17. gate

内部 Gate：`READY_FOR_GPT_REVIEW`。  
本阶段不进入 STAGE D；等待 GPT 审查和用户第 11 节人工验收。
