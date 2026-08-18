# Codex Workbench V1 — STAGE D

## official_stage_name

`Thread 标题 + 左侧导航状态`

## scope_resolution

```text
STAGE D NAME: Thread 标题 + 左侧导航状态
GOAL: 让用户通过人类可读标题识别 Thread，并让左侧只表达轻量、真实的运行活动
IN SCOPE: Native title/displayTitle 投影、确定性首条用户消息 fallback、用户重命名、displayTitle 持久化、左侧 activity indicator、Header/Sidebar 一致性
OUT OF SCOPE: STAGE E Message Stream、STAGE F Composer Capability、Project lifecycle、Map UI、Attachment、Workflow、Review、Git Workbench、Multi-Agent 产品层
EXPECTED PRODUCT BEHAVIOR: Native title 或用户 displayTitle 优先展示；无标题时显示确定性 fallback；running/waiting_user 仅显示轻量 indicator；Turn failed 不永久污染 Thread 行；unavailable 保留明确提示
ARCHITECTURE BOUNDARY: Native Thread 是唯一身份，Native Turn/Item 是运行事实，Codex App Server 是 Runtime 主路径；displayTitle 只属于 UI metadata，不参与 resume、Runtime、Context、Map 或消息历史
DEPENDENCIES ON STAGE A/B/C: 保留多 Runtime/active-thread truth、滚动/常驻 Composer、Diagnostics 原始定位与错误追溯
MANUAL ACCEPTANCE: 由用户按本报告清单执行；Codex 不将 CLI/静态测试冒充 GUI PASS
GATE: 内部自动化与真实 smoke READY_FOR_GPT_REVIEW；不进入 STAGE E
```

## source_documents

- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`：本阶段最新正式规划输入。
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`：V1 Native Thread、App Server 和薄 Workbench 边界。
- `docs/STAGE-C-UI-PROJECTION-DIAGNOSTICS.md`：Stage C 冻结与 Diagnostics 边界。
- `docs/STAGE-B-IMPLEMENTATION.md`：Workspace Scroll / Composer 冻结证据。
- `docs/STAGE-A-MULTI-THREAD-RUNTIME.md`、`docs/STAGE-A-POST-ACCEPTANCE-FIX.md`：Runtime、writer conflict、orphan、restart/reopen 不变量。
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`：当前开发路线与阶段状态。

`v1.1.docx`、`v1.2.docx` 和 `dist-stage-a/` 均作为用户本地规划/构建输入保护，未加入本次 commit。

## base_and_freeze

- `stage_c_freeze_commit`: `28f7f62 docs: freeze stage c after manual acceptance`
- `base_commit`: `28f7f62`
- `implementation_commit`: same commit as this report; see `git HEAD` and the final stage review below

## title_source_audit

当前 `src/codex/native-thread-runtime.ts` 的真实 `thread/read` 路径从 Native thread 原始对象读取 `title`，并兼容 `name`；返回 `ThreadReadView.title`。本阶段没有猜测或新增 App Server rename API，也没有把 Native title 写回 Runtime。

由于导航列表接口本身只返回本地 ThreadProjection，为避免启动时逐个 resume/read 造成额外 Runtime 副作用，Renderer 在真实读取某 Thread 后按 `nativeThreadId` 缓存该 Thread 的原生 title 和首条有效用户消息 fallback。Native title 缺失时，确定性 fallback 以 `displayTitleSource: auto` 持久化，保证后续冷启动仍可识别；不会把 ID 截取成用户标题。

## title_priority

按最新规划最终采用：

```text
user-renamed displayTitle
> native/original title
> deterministic first-user-message fallback
> 新对话
```

清空用户自定义标题后恢复 Native/自动标题。`nativeThreadId` 仍只在 Developer / Diagnostics、错误详情和必要 source trace 中展示。

## display_title

### schema

现有 ThreadProjection 的本地 `title` 字段明确改名为 `displayTitle`，仍是最小 UI metadata；同时保存 `displayTitleSource`（`user` / `auto`）区分用户重命名与确定性 fallback。持久化读取兼容旧版本 `title` key，写入统一使用 `displayTitle`。没有新增 Transcript、摘要、Context 或 Agent 状态字段。

### fallback

Renderer 对已读取的 Native Thread 扫描 Native Read Model 中第一条 `userMessage` / `userInput`，只做 `trim`、去换行/空白归一和确定性长度限制（80 字符）。Native title 缺失时将其作为 `displayTitleSource: auto` 的轻量 UI metadata 持久化；不调用 Agent，不总结完整对话，不保存消息历史副本。

### rename

Header 提供轻量“重命名 Thread”对话框。保存/清空只调用现有 Thread projection IPC，写入 `displayTitle`；不修改 `nativeThreadId`、Native title、Runtime resume 参数、Turn/Item 或 Map source。

### persistence

使用现有 `V1PersistenceStore` 的原子 mutation 机制和长度约束。旧持久化文档中的 `title` 会在读取时作为兼容输入映射为 `displayTitle`，Thread identity 保持不变。

## navigation_state

- `running`：左侧显示轻量圆点 indicator。
- `waiting_user`：显示轻量等待 indicator。
- `starting`：显示轻量启动 indicator。
- `completed` / `ready` / idle：不显示永久状态标签。
- `failed` Turn：不保留永久 failed/红色 Thread 标签；错误仍在当前 Workspace 和 Diagnostics 中可查。
- `unavailable` / orphan：保留明确“不可用”状态；不删除 projection、不替换 ID、不 fallback 发送。
- 冷启动没有 RuntimeSnapshot 时，已有 `disconnected` / `recovery_required` projection 保留轻量 `!` 指示，不伪装成正常空闲。
- `writer conflict`：不把 Thread 永久写成 failed；保留克制的冲突提示和原始 Diagnostics 错误，后续可按同一 Native ID retry。

左侧状态来自现有 per-thread `RuntimeSnapshot` / projection error，不建立第二套 Thread execution state machine。后台 A/B 状态不会被当前选中 Thread 覆盖。

## header_sidebar_consistency

Header 与 Sidebar 均调用同一个 `threadLabel()` 投影函数，因此使用相同的 displayTitle → Native title → 自动 fallback 优先级。Header 的完整 Native ID 仍仅在 Diagnostics 区域出现。

## files_changed

产品/共享代码：

- `src/shared/runtime-types.ts`
- `src/shared/persistence-store.ts`
- `src/main/main.ts`
- `src/renderer/thread-title.ts`
- `src/renderer/renderer.ts`
- `src/renderer/index.html`

验证代码：

- `tests/thread-title.test.ts`
- `tests/persistence-store.test.ts`
- `tests/navigation-model.test.ts`
- `tests/workspace-layout-contract.test.ts`
- `tests/native-thread-runtime.test.ts`

文档：

- `docs/STAGE-D-THREAD-TITLE-NAVIGATION-STATE.md`
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`

未修改旧 donor、Native protocol、RuntimeRegistry、Map store、Project ownership 规则和用户本地规划文件。

## implementation

- 将 ThreadProjection 本地标题元数据显式命名为 `displayTitle`，并兼容读取既有 `title` 持久化 key。
- 用 `displayTitleSource: user|auto` 区分显式重命名与确定性自动 fallback；Native title 存在时自动 fallback 不覆盖 Native title。
- 在真实 `thread/read` 成功后缓存 Native title 和确定性首条用户消息 fallback。
- Native title 缺失时持久化首条用户消息短标题，保证后续冷启动导航仍可识别，不逐个启动 Runtime 读取历史。
- Sidebar/Header 统一使用标题投影；Sidebar 不再把 ready/failed 当作 Thread 永久身份标签。
- 增加轻量 Thread rename dialog，通过现有 IPC 持久化 displayTitle。
- 历史失败/中断 Turn 增加用户可读的 Turn 级提示；recovery/disconnected projection 在冷启动左侧保留轻量警示。
- 保持 unavailable、writer conflict、Composer target、Diagnostics 和后台多 Thread Runtime 既有语义。

## source_of_truth_boundary

```text
Native Thread              = 唯一对话身份
Native Turn / Native Item  = 消息和运行事实
Codex App Server            = Runtime 主路径
ThreadProjection.displayTitle = 本地 UI metadata，仅用于标题展示
Renderer title cache        = 当前会话展示缓存，不是持久化事实层
```

`displayTitle` / `displayTitleSource` 不参与 `thread/resume`、`thread/read` 参数、`turn/start`、Context、Map semantic update 或 Transcript reconstruction。

## stage_a_regression

- `RuntimeRegistry<nativeThreadId>`、多 Thread 后台并行、per-thread events/Approval/Stop 未改动。
- writer conflict 不替换 ID；orphan 不删除 projection、不 fallback；restart/reopen 仍使用同一 Native ID。
- 本轮真实 `npm run test:real:navigation`、`npm run test:real:workspace`、`npm run test:real:multi-thread` 均通过。

## stage_b_regression

- 固定 Header、Conversation 独立滚动、Composer 常驻、底部跟随、Jump to latest 代码未改变。
- 既有 73/73 Stage B 自动化与用户 GUI PASS 作为冻结基线；本轮 workspace layout contract 仍通过。
- 本阶段没有进入 Composer Capability 或消息流重做。

## stage_c_regression

- Developer / Diagnostics 仍默认折叠，Native ID、raw/read、Turn/Item source trace 仍可定位。
- 原始错误和按 Thread 诊断日志保持隔离；标题投影不复制 Transcript，也不改变默认消息投影。
- Stage C 已由 `28f7f62` 冻结，未回退其协议降噪和错误追溯规则。

## tests

以下命令均在 `D:\办公\AI\Codex_Workbench_V1` 执行：

- `npm run check`：PASS。
- `npm test`：81/81 PASS。
- `npm run build`：PASS（`BUILD PASS`）。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：PASS；只有 Windows 换行转换提示，无 whitespace error。
- secret scan：PASS；命中内容仅为既有测试 fixture 中的字面量 `token: "kept"`，不是凭据或 Secret。

新增/覆盖：Native title 与 displayTitle 优先级、Native title/name 解析、首条用户消息 fallback、标题清洗/长度、旧 title key 兼容读取、user/auto source、rename IPC contract、identity 不变、Turn 级失败提示和无永久 failed 标签。

## real_appserver_smoke

- `npm run test:real:navigation`：PASS；真实 Project/Standalone Thread 创建、切换、重启恢复和事件归属通过。
- `npm run test:real:workspace`：PASS；真实 interrupt → continue → `thread/read` → restart/reopen 同一 Native ID 通过。
- `npm run test:real:multi-thread`：PASS；两个真实 Native Thread 并行完成，A/B event markers 按 Thread 隔离。

本轮没有伪造 Native title，也没有声称真实 smoke 稳定返回了非空 title；contract 已验证 `thread/read` parser 读取 `title/name`，Native title 缺失时由带 source 的 displayTitle/确定性 fallback 接管。

## manual_acceptance_required

Codex 不将 CLI/static test 冒充 GUI PASS。请用户在当前构建中复测：

1. 左侧主要显示人类可读标题，不再以 UUID 作为正常标题。
2. Header 与左侧标题一致。
3. Native title 不可用时形成合理 fallback；首条用户消息过长时只做简单截断/清理。
4. 手动重命名即时生效，重启后仍保留；清空后恢复 Native/自动标题。
5. A/B 同时运行时两个 Thread 的轻量 indicator 独立显示，Stop B 不影响 A。
6. Turn 完成后 indicator 消失；Turn failed 后 Thread 不永久显示 failed/红色。
7. writer conflict 不永久污染 Thread；orphan 仍明确 unavailable 且不可误发送。
8. Pinned / Projects / Recent 归属不受影响。
9. STAGE B 滚动/Composer 无回归。
10. STAGE C Diagnostics 仍可查看真实 Native ID、错误和 source trace。

## subagents

本阶段三个只读审计子代理均自然完成并返回，未写产品文件：

| agent | task | result | adopted | final_status | closed_after_result |
| --- | --- | --- | --- | --- | --- |
| Feynman (`01a01353-fe92-75e1-a9e3-44c306ac0b09`) | v1.2 scope 与阶段边界审计 | 确认 Stage D 唯一且无冲突；建议 user rename 显式覆盖 Native title | 是 | completed | yes |
| Epicurus (`01a01354-0186-7253-a9b0-88640e7f44f4`) | Native title、displayTitle、persistence、IPC 审计 | 确认 thread/read title/name 与 identity 保护；指出冷启动标题和专项解析测试边界 | 是 | completed | yes |
| McClintock (`01a01354-0456-7722-9578-695e798e5374`) | Sidebar/Header、状态语义、Stage A/B/C 回归审计 | 指出冷启动 fallback、Turn 失败提示、recovery/disconnected indicator 缺口；均已补齐 | 是 | completed | yes |

`running_subagents_at_gate: 0`。

## local_user_files_status

- `dist-stage-a/`：保持用户原状态，未 add、未修改。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`：保持用户原状态，未 add、未修改。
- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.2.docx`：保持用户原状态，未 add、未修改；仅作规划输入。
- `V1docs.zip`：保持用户原状态；本轮未 add、未修改。

## legacy_project_status

`D:\办公\AI\Codex_Workbench` 仅只读核对，保持其原有用户 dirty baseline；未 reset、clean、stash、checkout、format 或 commit。`D:\办公\AI\Auto_Agent` 未修改。

## scope_boundary

本阶段只完成 Thread title projection、displayTitle rename/persistence 和左侧 activity state semantics；不进入 STAGE E，不修改 Message Stream、Composer Capability、Project lifecycle、Map UI、Visual Polish、Attachment、Workflow、Review、Git Workbench 或 Multi-Agent 产品系统。

## known_limitations

- 未对所有导航 Thread 自动执行 `thread/read`，因此从未产生过首条用户消息的 Thread 显示 `新对话`；已有自动 fallback 会持久化，避免启动时无边界 resume/read 副作用。
- Native title 的非空返回未由本轮真实 smoke 强制制造；协议解析路径已存在，缺失时使用 fallback。
- 没有自动化 Electron GUI 驱动；标题即时显示、重启后 GUI、indicator 动画仍需用户人工复测。

## blockers

none for automated validation. Awaiting GPT review and user GUI acceptance.

## gate

`READY_FOR_GPT_REVIEW`

本阶段内部实现完成，Conversation Map 已更新为 `STAGE C → ●`、`STAGE D → ◉`、`STAGE E → ○ NOT_STARTED`；完成后停止，不进入 STAGE E。
