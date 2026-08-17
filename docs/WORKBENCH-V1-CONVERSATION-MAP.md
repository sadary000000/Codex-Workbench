# Codex Workbench V1：Conversation Map 初始化

日期：2026-08-17
阶段：Phase 5 筛选完成，待 GPT Gate
状态：人工可读 Map 已 PASS；Phase 5 Legacy 筛选已完成
范围：当前 Codex Workbench V1 开发对话

## 1. 文档定位

本文件是当前开发对话的第一版人工可读 Conversation Map。它用于把已经完成的工作、正在进行的工作、后续路线和历史决策放在同一张可追溯的工作地图中，不替代原始 Codex 对话，也不是产品运行时的 Map 数据文件。

Map 初始化阶段只完成一次人工可读呈现；后续阶段状态追加在同一张地图中：

- 不实现 Map Schema、JSON Patch、Full Rebuild 协议或持久化格式；
- 不新增 Map UI、右侧 Panel 或 Project Map 维护 Thread；
- 不扫描或复制 Codex 的完整 Conversation / Transcript / Context；
- 初始化阶段不进入 Phase 5 Legacy 能力筛选；Phase 5 结果已在本文后续节点登记；
- 不修改产品代码，也不修改只读 donor 项目。

Map 的语义判断仍属于 Codex；Workbench 在未来只负责调用、准备增量材料、记录同步位置、校验返回格式、保存和展示结果。

## 2. 统一状态和阅读方式

本地图沿用已冻结的四种工作状态：

| 符号 | 状态 | 含义 |
| --- | --- | --- |
| ○ | 计划中 | 已规划，但尚未进入实际执行 |
| ◉ | 进行中 | 当前正在推进 |
| ● | 已完成 | 已形成稳定结果 |
| ! | 阻塞 | 存在阻碍，当前无法正常继续 |

“取消、替代、放弃、旧方案”不另造第五种状态，统一写入节点历史或详情。

## 3. 当前开发工作地图

```text
● Codex Workbench V1：以 Codex 原生 Thread Workspace 为主体验的干净重建
├── ● 产品与架构冻结
│   ├── V1 Scope Freeze：Codex 主干、Workbench 薄适配、Map 为唯一增强
│   └── Map 产品对齐：Conversation Map / Project Map 规则已确认，技术实现后置
├── ● Phase 0：新工程与工程边界
│   └── 独立 D:\办公\AI\Codex_Workbench_V1 建立，旧项目冻结为 donor/reference
├── ● Phase 1：Native Runtime 最小垂直链路
│   └── initialize / thread / turn / interrupt / resume / read 真实链路成立
├── ● Phase 2：身份、持久化与可靠性
│   └── Native identity、Project/Standalone projection、Prompt Recovery、fail-closed 恢复
├── ● Phase 3：Codex 式左侧导航
│   └── Pinned / Projects / Recent 围绕真实 Native Thread 投影
├── ● Phase 4：Codex Thread Workspace
│   └── Native Thread → Native Turn → Native Item、事件流、Composer、Stop、Approval、恢复状态
├── ● Phase 4 Gate：GPT 审查通过
│   └── commit c322b97；Phase 4 PASS；允许进行当前开发对话的 Map 初始化
├── ● Conversation Map：首次人工可读初始化（本文件）
│   ├── ● 已读取 V1 Scope Freeze、Map 产品对齐、重建路线和 Phase 0–4 证据
│   ├── ● 已整理当前路径、历史替代路线、来源和边界
│   └── ● GPT 审查通过，并给出 Phase 5 唯一执行指令
├── ● Phase 5：Legacy 能力筛选
│   ├── ● 四项只读 donor 审计已完成并交叉复核
│   ├── ● Legacy capability matrix 完成，实际代码迁移 0 项
│   └── ◉ 提交 Phase 5 结果给 GPT 审查
├── ○ Phase 6：Map 产品技术实现
│   └── 设计 Schema / Prompt / Patch Protocol / 按需 Panel / Conversation Map / Project Map
└── ○ Phase 7：真实使用后的增强
    └── 只有真实缺口证明必要时再讨论 Workflow、Review、Git 等扩展
```

当前主路径是“Phase 4 PASS → Conversation Map PASS → Phase 5 筛选完成 → GPT 审查 Phase 5”。Phase 6 仍未开始。

## 4. 节点详情与来源

| 节点 | 状态 | 当前结果 | 主要来源 |
| --- | --- | --- | --- |
| 产品与架构冻结 | ● | V1 产品边界、Native Thread 主路线和 Map 产品规则已对齐；技术 Schema/Prompt/Patch 仍后置 | `指导文档\Workbench_V1_功能范围冻结_2026-08-17.docx`、`指导文档\Workbench_Map_产品对齐记录_2026-08-17.docx` |
| 新 V1 工程边界 | ● | 新项目独立存在；旧 `D:\办公\AI\Codex_Workbench` 仅作只读 donor/reference | `指导文档\Workbench_V1_重建路线规划_2026-08-17.docx`、Phase 0/1 报告 |
| Native Runtime 主链 | ● | App Server 原生 Thread/Turn/Item 可创建、读取、继续和恢复 | `docs\PHASE-01-NATIVE-THREAD-FOUNDATION.md` |
| Identity / Recovery | ● | Native identity 为唯一运行事实；Prompt 失败/重启路径可解释，不静默替换 Thread | `docs\PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md` |
| Codex 式导航 | ● | Pinned / Projects / Recent 围绕 ThreadProjection；Project Thread 不重复进入 Recent | `docs\PHASE-03-CODEX-SHAPED-LEFT-NAVIGATION.md` |
| Codex Thread Workspace | ● | Native read model、事件归一化、Turn/Item 流、Composer、Stop、Approval broker、恢复状态已实现 | `docs\PHASE-04-CODEX-THREAD-WORKSPACE.md` |
| Phase 4 Gate | ● | GPT 已明确给出 PASS；附件、设置 UI、compaction 展示等限制不构成 blocker | GPT 审查对话（2026-08-17） |
| Conversation Map 初始化 | ● | 本文件形成第一版人工可读工作地图；GPT 已 PASS 并给出 Phase 5 唯一执行指令 | 本文件、GPT Map 审查 |
| Phase 5 Legacy 筛选 | ● | 四项只读审计完成；分类矩阵完成；实际 donor code migration 为 0；待 GPT Gate | `docs\PHASE-05-LEGACY-CAPABILITY-MATRIX.md`、`docs\PHASE-05-LEGACY-CAPABILITY-SCREENING.md` |
| Phase 6 Map 技术实现 | ○ | 尚未开始；不得在本阶段提前设计 Schema/Patch/UI | Scope Freeze、Map 产品对齐记录 |

## 5. Phase 0–4 阶段证据摘要

本节按附件指令为每个已执行阶段保留最小可追溯记录；不复制完整阶段报告。`PASS` 均引用阶段报告中已完成的机器/真实验证，本次 Map 文档阶段只重新运行了 `npm run check` 和 `npm test`。

### Phase 0 — 新工程与工程边界

- 状态：● 已完成。
- 阶段目标：建立独立 Electron/TypeScript V1 工程、Main/Preload/Renderer/Codex/Shared 边界和基础检查脚本；旧项目只读。
- 实际完成：`D:\办公\AI\Codex_Workbench_V1` 独立运行；未继承旧 Conversation / Transcript / Task 产品架构。
- 关键架构决策：Native Thread 作为新 V1 对话身份；旧 Workbench 作为 donor/reference，不作为迁移目标。
- 关键 commit：`f3f11cc feat: establish native thread foundation`（与 Phase 1 基础链路同一提交）。
- Gate / 测试：`npm run check` PASS；`npm test` 7/7 PASS；`npm run build` PASS；`npm audit --omit=dev` 0 vulnerabilities；Electron `npm run dev` 输出 `app_ready`。
- 真实 App Server：不把 Phase 0 单独描述为 Runtime smoke；真实 Native 验证归入 Phase 1。
- 已知限制：只有调试界面；Approval、正式 Workspace、导航、Map 和 Legacy 迁移均未开始。
- blocker：none。下一步：Phase 1 Native Runtime 垂直链路。
- 来源：`docs\PHASE-01-NATIVE-THREAD-FOUNDATION.md`、`git log`。

### Phase 1 — Native Runtime 最小垂直链路

- 状态：● 已完成，基础 Gate 由 `cc7b523 test: close native foundation gate` 收口。
- 阶段目标：真实接通 App Server `initialize`、`thread/start`、`thread/read`、`thread/resume`、`turn/start`、`turn/interrupt` 和 Native Turn/Item。
- 实际完成：获得稳定真实 `nativeThreadId`；可完成 Turn、读取历史、resume 同一 Thread、继续第二个 Turn，并保留 interrupted Turn。
- 关键架构决策：Codex App Server 是 V1 Runtime 主路线；Exec 不作为新 V1 主链；server request 默认 fail-closed。
- 关键 commit：`f3f11cc feat: establish native thread foundation`、`cc7b523 test: close native foundation gate`。
- Gate / 测试：`npm run check` PASS；`npm test` 7/7 PASS；`npm run build` PASS；`npm audit --omit=dev` 0 vulnerabilities。
- 真实 App Server：Codex CLI 0.147.0 创建真实 Thread，完成 Turn、`thread/read`、`thread/resume`、继续 Turn 和真实 `turn/interrupt`；Electron 输出 `app_ready`。
- 已知限制：调试 UI 尚非正式 Thread Workspace；无 Approval Card；当时只持久化一个 binding；真实 smoke 产生的 Native Thread 属于本机 Codex 会话记录。
- blocker：none。下一步：Phase 2 Identity / Persistence / Reliability。
- 来源：`docs\PHASE-01-NATIVE-THREAD-FOUNDATION.md`、`scripts\real-app-server-smoke.ts`、`git log`。

### Phase 2 — Identity / Persistence / Reliability

- 状态：● 已完成。
- 阶段目标：建立薄 Project/ThreadProjection、Prompt Recovery、错误分类、restart/resume/read 和 fail-closed 身份保护。
- 实际完成：`nativeThreadId` 不静默替换；`workbench-state.json`、binding、Project/Standalone projection、Prompt Recovery、损坏状态拒绝和关闭/进程退出恢复路径成立。
- 关键架构决策：不保存完整 Native Transcript；`localRunId` 只做 correlation/诊断；失败时保留 Prompt，不自动重发或伪造 active Turn。
- 关键 commit：`983d322 feat: establish identity persistence reliability foundation`。
- Gate / 测试：`npm run check` PASS；`npm test` 16/16 PASS；`npm run build` PASS；`npm audit --omit=dev` 0 vulnerabilities。
- 真实 App Server：已有 Native Thread resume、真实 Turn 完成、`thread/read`、真实 interrupt、interrupt 后 Projection ready，三处 `nativeThreadId` 一致。
- 已知限制：只有一个 Main Runtime active slot；跨进程 active Turn 只检测并报告；没有正式导航、Workspace、Approval UI、Map 或 Legacy migration。
- blocker：none。下一步：Phase 3 Codex-shaped Left Navigation。
- 来源：`docs\PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md`、`src\shared\persistence-store.ts`、`src\codex\native-thread-runtime.ts`、`git log`。

### Phase 3 — Codex-shaped Left Navigation

- 状态：● 已完成。
- 阶段目标：用 Pinned / Projects / Recent 组织真实 Native Thread，不创建 Workbench Conversation 来模拟 Thread。
- 实际完成：Project Thread、Standalone Thread、Pinned shortcut、Project 内新建和 Thread 切换；Project Thread 不重复进入 Recent；projection ownership 保持。
- 关键架构决策：`ThreadProjection` 以 `nativeThreadId` 为唯一 key；Pinned 不改变归属；仍只有一个 active Runtime slot。
- 关键 commit：`f03e8d9 feat: add native thread left navigation`。
- Gate / 测试：`npm run check` PASS；`npm test` 20/20 PASS；`npm run build` PASS；`npm audit --omit=dev` 0 vulnerabilities。
- 真实 App Server：`npm run test:real:navigation` 验证两个 Project Thread、一个 Standalone Thread、A1 → A2 → S1 切换、重启恢复和 4 个 completed events。
- 已知限制：仍只有一个 active Runtime slot；Project 创建入口轻量；中间 Workspace 仍为 Phase 4 之前的占位；Map 未实现。
- blocker：none。下一步：Phase 4 Codex Thread Workspace。
- 来源：`docs\PHASE-03-CODEX-SHAPED-LEFT-NAVIGATION.md`、`scripts\real-navigation-smoke.ts`、`git log`。

### Phase 4 — Codex Thread Workspace

- 状态：● 已完成；GPT Gate：PASS。
- 阶段目标：围绕 Native Thread → Native Turn → Native Item 建立 Thread Header、Turn/Item stream、事件归一化、Composer、Stop、Approval、Reconnect/Failure 状态。
- 实际完成：rich `thread/read`、Native Event normalizer、Command/File/Web/Approval/Unknown 展示、Prompt Recovery、真实 interrupt/continue/restart、native approval broker 和 scroll/jump-to-latest。
- 关键架构决策：Renderer 只有视图缓存/草稿，不建立第二套 Conversation / Transcript / Task / Agent truth；未知 Native 类型安全保留。
- 关键 commit：`c322b97 feat: implement native thread workspace`。
- Gate / 测试：`npm run check` PASS；`npm test` 32/32 PASS；`npm run build` PASS；`npm audit --omit=dev` 0 vulnerabilities；secret scan PASS。
- 真实 App Server：`npm run test:real`、`npm run test:real:navigation`、`npm run test:real:workspace`（隔离状态目录）均 PASS；workspace smoke 验证 interrupt → continue → restart 后保持同一 `nativeThreadId`。
- 已知限制：未做人工 GUI 测试；read-only/never 策略下真实 Approval 未稳定触发，仅有 fake JSON-RPC contract/validator/IPC 证据；无附件和伪造的 model/reasoning/permission UI；第一次未隔离 real smoke 的 active writer 冲突不作为产品失败证据。
- blocker：none。Phase 4 Gate 后先完成 Conversation Map；该 Map 已 PASS，随后进入 Phase 5 Legacy 筛选。
- 来源：`docs\PHASE-04-CODEX-THREAD-WORKSPACE.md`、`scripts\real-thread-workspace-smoke.ts`、GPT Phase 4 审查对话、`git log`。

## 6. 当前工作路径

### 6.1 已完成主路径

1. 旧 Workbench 的 Conversation / Transcript / Task 产品架构不作为新 V1 的事实层。
2. 新 V1 以 Codex App Server 的 Native Thread → Native Turn → Native Item 为运行事实。
3. 先建立可靠性，再建立 Codex 式导航，再实现 Native Thread Workspace。
4. Phase 4 已通过命令行、单元测试、构建、审计和真实 App Server smoke 验证。
5. GPT 已审查通过 Phase 4 Gate 和 Conversation Map；Phase 5 已完成只读筛选，当前提交 Phase 5 Gate。

### 6.2 当前进行中的工作

当前只剩 Phase 5 筛选结果的阶段审查：

- 校验地图是否覆盖已完成阶段、当前阶段、下一阶段和历史路径；
- 校验每个重要节点是否能回到原始报告或冻结资料；
- 校验四项 donor 审计、分类、0 项代码迁移和 Native truth 边界；
- 将 `[CODEX_WORKBENCH_STAGE_REVIEW]` Phase 5 结果提交给 GPT。

### 6.3 下一步计划

| 顺序 | 状态 | 动作 |
| --- | --- | --- |
| 1 | ● | GPT 审查 Conversation Map 初始化并返回 PASS |
| 2 | ● | 接收 Phase 5 唯一执行指令 |
| 3 | ● | 完成 Legacy 能力审计、分类和 0 项代码迁移决策 |
| 4 | ◉ | 提交 Phase 5 Gate；仅在 GPT PASS 后进入 Phase 6 |

若 Phase 5 GPT Gate 返回 FIX 或 REDESIGN，只修订 Phase 5 文档，不启动 Phase 6。

## 7. 已冻结的产品规则

这些是 Map 的产品边界，不是本阶段要实现的技术协议：

- Codex 负责理解、判断、规划和语义整理；Workbench 不复制 Agent、Reasoning、Context 或 Map AI。
- Conversation Map 是单个 Codex Conversation / Thread 的细粒度工作地图，不是聊天时间线、摘要列表或 Task 数据库镜像。
- Map 节点表达实际工作；结论、原因、方案、约束和被替代路线放在节点详情中。
- 重要节点必须可追溯到原始聊天或阶段证据；重大路线变化先通过正常对话与用户确认。
- Conversation Map 可选启用；未启用时普通 Codex 对话仍正常工作。
- 正常情况下，Conversation Map 应尽量由当前 Codex 本轮工作与用户输出一起产生 Map Patch，不能默认额外启动一个总结器。
- 首次启用允许一次必要历史初始化；初始化后转为增量维护，不反复全量扫描历史。
- 日常更新使用 Map Patch；首次初始化、用户明确要求重整或严重损坏恢复时才允许 Full Rebuild。
- 暂停 Map 维护时仍记录 dirty；恢复后从上次处理位置追上，不丢失暂停期间的工作。
- Project Map 是项目级粗粒度地图，由默认隐藏/弱化的专用 Codex Thread 维护；它不在本阶段创建。
- Project Map 跨 Conversation 做语义合并，冲突不能简单按最后写入覆盖；重大冲突需要用户确认，旧路线保留为历史。

## 8. 本阶段的人工初始化结果

本文件把当前开发对话中可以确认的内容整理为以下层级：

### 根节点：Codex Workbench V1 重建

目标是获得“尽量保持 Codex Desktop 使用心智的 Codex 工作台”，同时只保留 Map 作为 V1 的 Workbench 差异化增强能力。主工作区必须围绕 Native Thread Workspace，Workbench 不建立第二套 Conversation / Transcript / Task / Agent 真相。

### 已完成分支：Native Thread Workspace 基线

Phase 0–4 已形成稳定基线。最后提交为 `c322b97 feat: implement native thread workspace`。Phase 4 证据包括：

- `npm run check` PASS；
- `npm test` PASS，32 passed / 0 failed；
- `npm run build` PASS；
- `npm audit --omit=dev` PASS，0 vulnerabilities；
- secret scan PASS；
- `npm run test:real`（隔离状态目录）PASS；
- `npm run test:real:navigation` PASS；
- `npm run test:real:workspace` PASS；
- 真实 workspace smoke 验证 interrupt 后继续同一 Native Thread，并在重启后保持相同 `nativeThreadId`。

### 当前分支：Conversation Map 初始化

本阶段的交付物是人工可读 Map 文档和来源索引。它表达当前开发路线，不向产品 Runtime 注册 Map，不创建 Native Map Thread，不保存本地 Transcript，也不改变 Renderer/Main/Preload 代码。

### 当前代码基线与 Map 能力边界

本次只读架构审计确认，下面是可以引用的当前实现事实：

- `nativeThreadId` 仍是唯一 Native Thread 身份；`thread/read` 使用 `includeTurns: true` 读取 Native Thread → Turn → Item。
- Native 读模型保留原生 ID、状态、类型、文本、输入、输出、错误和 `raw`；Renderer 是视图缓存/事件展示层，不能被写成第二套 Conversation 或 Transcript 真相。
- `ThreadProjection` 以 `nativeThreadId` 为 key；`projectId = null` 表示 Standalone；Pinned 是快捷入口，不复制 Thread，Project Thread 不进入 Recent。
- `native-thread-binding.json` 只保存当前 active Thread 的薄绑定；`workbench-state.json` 保存版本化 Project、ThreadProjection 和 Prompt Recovery，不保存完整 Native Turn/Item 历史。
- Prompt Recovery 的 `localRunId` 只是 IPC correlation/诊断标识，不是 Task 或 Conversation ID；失败、超时、进程退出时保留恢复信息，不自动重发 Prompt 或伪造 active Turn 续接。

当前明确不存在以下 Map 实现：

| 能力 | 当前事实 |
| --- | --- |
| Conversation Map Schema | 不存在；通用 `workbench-state.json` 不是 Map Schema |
| Map Patch Protocol / Applier | 不存在；`ThreadProjectionPatch`、`PromptRecoveryPatch` 不是 Map Patch |
| Map UI | 不存在；当前 UI 是 Native Thread 导航、Turn/Item Workspace、Composer、Approval 和 Debug 区 |
| Map snapshot / node / source reference / dirty / processed cursor / patch log | 不存在 |
| Project Map maintenance Thread | 不存在；没有 `mapThreadId`、hidden kind、创建 API、调度或测试 |

因此，本文件中关于“首次初始化、增量、同步位置、dirty、来源回跳、隐藏 Project Map Thread”的文字都是已对齐的产品规则或未来设计边界，不是当前代码已经具备的能力。`lastKnownTurnId` 也不能写成 Map 的 `lastProcessedTurnId`；两者属于不同层级。

### 未来分支：Phase 5 / Phase 6

Phase 5 只筛选真正需要的 Legacy 安全底座、诊断和边界清晰的基础设施；旧产品层功能默认不迁移。Phase 6 才设计并实现 Map Schema、Prompt、Patch Protocol、增量同步、dirty/pause/resume、右侧按需 Panel、Conversation Map 和 Project Map。

## 9. 历史与替代路线

历史信息不使用额外工作状态：

- “继续在旧 Workbench 上重构”已被“创建独立 V1 工程”替代。旧项目保留为只读 donor，不是本阶段迁移目标。
- 旧 Workbench 的 Conversation / Transcript / Task / Exec 主架构不进入新 V1 主路径；只有后续被证明安全且边界独立的底层能力才可能进入 Legacy 筛选。
- 在 Phase 4 稳定前实现 Map 的路线被延后到 Phase 6；当前只保留产品规则和扩展位置，不提前实现技术层。
- 当前的 Map 初始化文档不是对旧对话的复制，也不是把所有历史消息重新保存一份；它只保留能影响当前路线的结果、来源和决策。

## 10. 明确不属于本次初始化的内容

以下项目当前状态均为“未实现”，不能在阶段报告中写成已完成：

- Map JSON Schema、节点 ID 规则、Patch 操作 schema、Full Rebuild 协议；
- Map Prompt 的最终版本、版本管理和运行时注入；
- Map 持久化数据库、同步 cursor 的真实字段和迁移；
- Conversation Map / Project Map UI、右侧面板、折叠树和性能策略；
- Project Map 隐藏维护 Thread 的真实创建、权限、调度、节流和失败重试；
- Phase 5 Legacy 筛选、迁移代码和 donor 复制；
- Workflow、Review、Task Manager、Parent/Child、Multi-Agent、Exec 主链、Git Workbench；
- 自研 Agent Runtime、Reasoning Engine、Context Manager、Tool Framework 或第二套消息真相。

## 11. 子代理执行协议

本阶段以及后续阶段固定采用以下生命周期：

```text
识别独立任务
  → 派发子代理
  → 主 Agent 继续不依赖其结果的主线工作
  → 等子代理真正完成并返回
  → 主 Agent 审核结果
  → 采用 / 驳回 / 补充验证并记录
  → 关闭已完成、明确失败或真实阻塞的子代理
```

“不影响主线推进”只表示主 Agent 不必停下等待，不表示可以丢弃子代理结果。阶段 Gate 前必须满足 `running subagents = 0`；不能因为主线已经完成、结果暂时用不上或等待时间较长而提前关闭。

各阶段使用的子代理审计结果已补入本节，记录：子代理任务、读取范围、返回结论、主 Agent 是否采用、关闭状态。

### 11.1 本次子代理审计记录

| 子代理 | 任务 | 最终返回与采用情况 | 状态 |
| --- | --- | --- | --- |
| Parfit (`01a00fb0-b97e-7a63-83d6-5c8bea501457`) | 只读审查三份冻结资料与 Phase 0–4 报告，整理人工 Map 文档规则、禁止提前实现项和 GPT 证据清单 | 返回完整规则清单；确认本阶段只能做人工文档，不能实现 Initial Map、Schema、Patch、Prompt、UI 或 Project Map Thread；主 Agent 已采用 | 已完成，已关闭 |
| Singer (`01a00fb0-ba17-7e12-8ea1-f7e447836204`) | 只读审查 V1 源码、测试、脚本、阶段报告和 Git 状态，核对 Native 基线与当前 Map 能力 | 返回 Native Thread/Turn/Item、Projection、binding、Prompt Recovery 的文件级证据；确认 Map Schema/Patch/UI/maintenance Thread 均不存在，并指出 `lastKnownTurnId`、Recovery、旧 README 等误报风险；主 Agent 已采用 | 已完成，已关闭 |

两个子代理均未修改 V1 文件，也未触碰旧 donor。主 Agent 在审阅本表后关闭它们；阶段 Gate 不保留运行中的子代理。

### 11.2 Phase 5 子代理审计记录

| 子代理 | 任务 | 最终返回与采用情况 | 状态 |
| --- | --- | --- | --- |
| Planck (`01a00fc6-b682-78a0-912f-315808fd3013`) | Runtime Donor Audit | 确认 V1 Runtime 主链保留；lifecycle/no-orphan、timeout cleanup、reconnect/reconcile、dedupe、capability preflight 作为后置 REWORK 候选；主 Agent 已采用 | 已完成，已关闭 |
| Nietzsche (`01a00fc6-b71c-7f50-a075-38989bca89b5`) | Security / IPC / Path Audit | 确认窄 IPC、Native identity、approval、persistence 基础；发现 cwd、sender/sandbox、strict reject、bounds、redaction 缺口；主 Agent 已采用为后置 hardening，不迁 donor | 已完成，已关闭 |
| Kepler (`01a00fc6-b7ee-7000-bccf-99705f7bc18d`) | Diagnostics / Git Safety Audit | 确认旧 logger/support/Git safety 有参考价值但绑定旧产品；V1 当前不添加 support/Git 产品；主 Agent 已采用 | 已完成，已关闭 |
| Archimedes (`01a00fc6-b8c8-7393-a4fe-863c826b34ca`) | Legacy Contamination Audit | 确认旧 donor 是 Conversation→Transcript→Task/Exec→Workflow/Review/Context/Renderer 整体产品系统；主 Agent 已采用旧产品层 LEGACY/REMOVE 边界 | 已完成，已关闭 |

四个 Phase 5 子代理均在返回最终结果并由主 Agent 审阅后关闭；没有未返回即关闭的情况，Phase 5 Gate 的 running subagents 为 0。

### 11.3 架构审计文件证据

以下路径是子代理实际核对的当前代码证据；它们只用于说明当前基线，不表示 Map 能力已存在：

- Native 读模型与运行入口：`src/shared/thread-read-model.ts`、`src/shared/runtime-types.ts`、`src/codex/native-thread-runtime.ts`。
- Project / Standalone 投影与导航：`src/shared/runtime-types.ts`、`src/renderer/navigation-model.ts`、`tests/navigation-model.test.ts`。
- 薄持久化 binding 和状态：`src/shared/thread-state-store.ts`、`src/shared/persistence-store.ts`。
- Prompt Recovery 与 Renderer 草稿：`src/shared/runtime-types.ts`、`src/codex/native-thread-runtime.ts`、`src/renderer/renderer.ts`、`tests/native-thread-runtime.test.ts`。
- 真实验证脚本与阶段证据：`scripts/real-navigation-smoke.ts`、`scripts/real-thread-workspace-smoke.ts`、`docs/PHASE-04-CODEX-THREAD-WORKSPACE.md`。

审计还确认：当前没有 Map snapshot、node、source reference、dirty、processed cursor、patch log、`mapThreadId`、隐藏维护 Thread、创建 API、调度或 Map 测试。Phase 5 另以 `docs/PHASE-05-LEGACY-CAPABILITY-MATRIX.md` 和 `docs/PHASE-05-LEGACY-CAPABILITY-SCREENING.md` 记录 donor 筛选；本文件和两份 Phase 5 文档均不包含产品代码修改。

## 12. 来源索引

### 产品和路线冻结资料

- `D:\办公\AI\Codex_Workbench_V1\指导文档\Workbench_Map_产品对齐记录_2026-08-17.docx`
- `D:\办公\AI\Codex_Workbench_V1\指导文档\Workbench_V1_功能范围冻结_2026-08-17.docx`
- `D:\办公\AI\Codex_Workbench_V1\指导文档\Workbench_V1_重建路线规划_2026-08-17.docx`

### 阶段证据

- `D:\办公\AI\Codex_Workbench_V1\docs\PHASE-01-NATIVE-THREAD-FOUNDATION.md`
- `D:\办公\AI\Codex_Workbench_V1\docs\PHASE-02-IDENTITY-PERSISTENCE-RELIABILITY.md`
- `D:\办公\AI\Codex_Workbench_V1\docs\PHASE-03-CODEX-SHAPED-LEFT-NAVIGATION.md`
- `D:\办公\AI\Codex_Workbench_V1\docs\PHASE-04-CODEX-THREAD-WORKSPACE.md`

### 当前运行身份与保护边界

- V1 工作目录：`D:\办公\AI\Codex_Workbench_V1`
- 旧 donor：`D:\办公\AI\Codex_Workbench`，只读，未修改
- Phase 4 commit：`c322b97`
- 当前 Map：本文件，人工可读初始化，不是 Runtime Map 数据

补充：README 中仍有 Phase 0–3 的历史性范围表述；本阶段以源码、`docs/PHASE-04-CODEX-THREAD-WORKSPACE.md` 和实际 Git HEAD 为当前 Phase 4 证据，不把 README 的陈旧描述当作实现状态依据。

## 13. 阶段审查请求

```text
[CODEX_WORKBENCH_STAGE_REVIEW]
stage: Phase 5 — Legacy Capability Screening
status: completed; donor audit and classification matrix complete; waiting GPT Gate
commit: docs-only commit containing the Phase 5 documents; final hash is recorded in the stage review
matrix_file: D:\办公\AI\Codex_Workbench_V1\docs\PHASE-05-LEGACY-CAPABILITY-MATRIX.md
report_file: D:\办公\AI\Codex_Workbench_V1\docs\PHASE-05-LEGACY-CAPABILITY-SCREENING.md
current_path: Phase 4 PASS → Conversation Map PASS → Phase 5 audit/classification → GPT Phase 5 Gate
completed_phases: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Conversation Map initialization, Phase 5 screening
active_phase: Phase 5 Gate review
next_planned_phase: Phase 6 — Map product technical implementation, only after Phase 5 PASS
map_statuses: ○ planned / ◉ in_progress / ● completed / ! blocked
frozen_principles_confirmed: Native Thread is the only conversation identity; Native Turn/Item are runtime facts; Codex owns Agent/Reasoning/Context/Tool semantics; Workbench is a thin product shell/projection/recovery adapter
product_rules: Codex owns semantic understanding; Workbench only orchestrates, validates, stores minimal sync state, and presents
phase5_scope: read-only donor inventory, KEEP/REUSE/REWORK/REFERENCE/LEGACY/REMOVE classification, no legacy product resurrection
inventory_summary: four read-only audits across Runtime, Security/IPC/Path, Diagnostics/Git Safety, and Legacy Contamination
classification_summary: KEEP V1 native baseline; REUSE immediate 0; REWORK deferred native/security/diagnostics hardening; REFERENCE historical utilities; LEGACY/REMOVE old product truth
KEEP: V1 App Server/JSON-RPC, Native Thread runtime, identity/persistence/recovery, approval broker, fixed IPC boundary, bounded event normalization, process environment
REUSE: none confirmed as currently required and safely portable
REWORK: native reconnect/reconcile/lifecycle cleanup; cwd/path canonicalization; IPC sender/strict payload/sandbox hardening; secret-safe logging/error diagnostics; optional support bundle
REFERENCE: old session/capability probe/lifecycle ideas, logger/support/Git safety tests, pure prompt-template algorithm for a future requirement
LEGACY: old adapters, Exec runner, Task/Workflow/Review/Prompt/Project Context/complex Renderer systems
REMOVE_DO_NOT_MIGRATE: Conversation, Transcript, Context Trace truth, runtime gateway, old IPC namespace, Git Keep/Revert, Multi-Agent product main path
actual_migrations: 0
v1_existing_capabilities_preserved: Native Thread/Turn/Item truth, App Server runtime, persistence/recovery, approval, fixed IPC, renderer projection
legacy_dependencies_removed: 0; no donor dependency was introduced
native_truth_audit: no Conversation/Transcript/Task/Agent/Context truth, old persistence schema, old IPC namespace, or Exec/Workflow/Review main path entered V1
tests: pending final verification; historical Phase 1–4 evidence remains source-scoped and is not re-reported as Phase 5 rerun
real_appserver_smoke: not rerun; no Runtime code migrated or changed, so expensive smoke is not required by this docs-only phase
conversation_map_update: Conversation Map initialization ●; Phase 5 screening ●; Phase 6 remains ○
subagents: Planck/Nietzsche/Kepler/Archimedes completed, returned, reviewed/adopted, and closed after result
running_subagents_at_gate: 0
legacy_project_status: old donor unchanged with pre-existing intentional dirty baseline; V1 product code unchanged
scope_boundary: no Phase 6 Map Schema/Prompt/Patch/UI/Project Map, no Workflow/Review/Task/Multi-Agent/Exec/Git resurrection, no product code migration
known_limitations: security/diagnostics/reconnect hardening candidates are recorded but not implemented; GPT must decide the next phase boundary
blockers: none
gate: pending GPT review

请审查 Phase 5 Legacy 能力筛选、分类矩阵、0 项代码迁移决策、Native truth 边界和子代理生命周期。若 PASS，请给出 Phase 6 唯一执行指令；若 FIX/REDESIGN，请列出必须修改项。审查通过前不进入 Phase 6。
```
