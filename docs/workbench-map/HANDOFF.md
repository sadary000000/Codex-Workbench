# Workbench 新对话交接入口

本文件是 **新 ChatGPT / Codex 会话进入 Workbench 项目的固定入口**。

它不保存一整份容易过期的项目状态，也不取代 Git / CI / durable checkpoint。新会话应先用本文件找到当前权威入口，再从 `CURRENT_CHECKPOINT.md` 跟随到当前 durable checkpoint。

## 1. 新会话最短阅读顺序

只想最快恢复当前工作时，按以下顺序读取：

1. `docs/workbench-map/HANDOFF.md` — 本文件，确认恢复协议；
2. `docs/workbench-map/CURRENT_CHECKPOINT.md` — 当前唯一 resume index；
3. `CURRENT_CHECKPOINT.md` 指向的 durable checkpoint — 当前工作流、精确产品快照、CI truth、Immediate resume sequence；
4. `docs/V0.1-MVP-SCOPE-FREEZE.md` — v0.1 冻结范围；
5. `docs/workbench-map/ARCHITECTURE.md` — Native-first ownership / truth boundary；
6. `docs/workbench-map/GIT_WORKFLOW.md` — branch / CI / merge discipline。

只有需要理解项目历史时，再读 `ROADMAP.md`、R5/R6/R7/R8 审计材料和历史 release checkpoint。**不要先从旧 Roadmap 阶段推断今天的继续点。**

## 2. 当前工作主线

当前主线是：**v0.1 Recovery Closure**。

当前 durable resume index 已指向：

`docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`

当前恢复实现线：

- integration base: `release/v0.1-integration`
- recovery branch: `fix/v01-recovery-closure`
- Recovery integration PR: Draft PR #55 -> `release/v0.1-integration`
- CI carrier: Draft PR #56 -> `workbench/next`，**只用于触发 CI，不得 merge**

Checkpoint 中记录的当前 Recovery 产品代码快照是：

`1e9d2ea15da176d3744c35bd833bfd4a29b56782`

注意：文档更新会让 recovery branch HEAD 晚于这个产品代码快照。恢复工作时必须区分：

- **branch HEAD**：可能包含后续 docs-only checkpoint/handoff commit；
- **product snapshot**：真正接受当前验证结论的代码 SHA。

任何新会话都必须重新查询 GitHub refs / PR / CI，不能把本文件缓存的 SHA 当实时 Git truth。

## 3. 当前验证状态

当前 checkpoint 记录的最新 Recovery 产品验证：

- `npm ci`: PASS
- Typecheck: PASS
- Unit/integration tests: **FAIL**
- Build: SKIPPED
- crash/restart Recovery E2E: 尚未完成
- authenticated Source Real E2E: 尚未完成
- Windows packaged Real E2E: 尚未完成
- final regression: 尚未完成

因此当前状态是 **IN PROGRESS / NOT RELEASE READY**。

不要把旧的 pre-Recovery Windows artifact、旧 Source Real E2E 或历史 PASS 当作当前 Recovery snapshot 的发布证据。

## 4. 当前 Recovery Closure 冻结边界

只处理已经确认的 v0.1 Recovery Closure：

- 继续复用 `ActionIntent / ActionAttempt / ExecutionAttempt / RecoveryCandidate / SideEffectClass / Reconcile`；
- Recovery 判断由后端唯一 Governance Projection 根据 durable truth 派生；
- 安全 Retry 必须创建新的 Intent / Attempt，并保留旧历史；
- provider / side effect 结果不确定时优先 Reconcile，禁止 blind resend；
- deterministic catch-up 只能使用已经持久化的 durable truth / Evidence；
- Repair/catch-up 不得伪造 Evidence；
- Renderer 只消费 backend-projected Recovery eligibility；
- 支持状态最终必须落入 Normal / Recoverable / Explicitly Blocked，禁止无出口死状态。

核心 invariant：

`NormalActions.anyAllowed || RecoveryActions.anyAllowed || Recovery.status === BLOCKED`

仍然明确不做：第二 Recovery runtime/state machine、force-skip validation、AI 猜 DB 修复、generic repair DSL、盲目重复 NON_REPEATABLE side effect、后台无限 retry、扩大 v0.1 Automation scope。

## 5. 新会话 Resume Protocol

新会话开始后直接执行，不重新规划整个项目：

1. 从 GitHub 读取本文件和 `CURRENT_CHECKPOINT.md`；
2. 按 `CURRENT_CHECKPOINT.md` 指针读取当前 durable checkpoint；
3. 查询当前 recovery branch、integration branch、PR #55、CI carrier PR #56 和最新 workflow 状态，核对 exact SHA；
4. 如果 Git truth 与 checkpoint 不同，先修正 checkpoint 认知，以 Git / CI 为准；
5. 从 durable checkpoint 的 `Immediate resume sequence` 开始；
6. 当前首要任务仍是最小修复现有 Unit/integration regression，不能通过削弱 Recovery invariant 让测试变绿；
7. deterministic CI 全绿后，严格按既定顺序继续：
   `crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression`；
8. 所有门禁通过前，不 merge PR #55、不标 ready、不宣布 v0.1 可发布；
9. 不重新规划 v0.1，不扩大已经冻结的 scope。

## 6. 可直接复制到新对话的启动指令

```text
继续 Codex Workbench 项目。

请先从 GitHub 仓库 `sadary000000/Codex-Workbench` 的当前 Recovery 工作分支读取：

1. `docs/workbench-map/HANDOFF.md`
2. `docs/workbench-map/CURRENT_CHECKPOINT.md`
3. `CURRENT_CHECKPOINT.md` 指向的 durable checkpoint

然后核对当前 Git refs、PR #55 / PR #56、exact product snapshot 和最新 CI 状态，按 durable checkpoint 的 `Immediate resume sequence` 直接继续。

当前主线是已经冻结的 v0.1 Recovery Closure。不要重新规划整个项目，不要扩大 v0.1 scope，不要新建第二套 Recovery/runtime/state machine，也不要用旧 E2E/Windows artifact 冒充当前 Recovery snapshot 的验证证据。

如果 checkpoint 与当前 Git/CI 有差异，以当前 Git/CI truth 为准并先校正上下文。完成 deterministic CI 后，继续固定顺序：crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression。
```

## 7. 长期不变量

- Codex Native Thread / Turn / Item 仍是 Native execution truth；
- Workbench 不复制第二 transcript / sandbox / Native tool executor / agent runtime；
- RequirementVersion / PlanVersion / Automation governance 是 Workbench 增量 truth；
- unknown external side effect -> reconcile before any repeat；
- Evidence 必须来自真实执行/验证事实，不能为推进状态而生成；
- Map / docs 是 projection 和 handoff surface，不是 Runtime Truth；
- 文档与当前 Git / CI / source 冲突时，修正文档，不反向扭曲事实源。

## 8. 维护规则

以后不要再把 HANDOFF 写成某个阶段的大型状态副本。

- `HANDOFF.md`：稳定的新会话入口、阅读顺序、继续规则、复制提示词；
- `CURRENT_CHECKPOINT.md`：当前 resume index，只指向最新 durable checkpoint；
- `V*_CHECKPOINT.md`：某次主线的 durable 状态、exact SHA、CI truth、Immediate resume sequence；
- `ROADMAP.md`：长期历史路线，不充当实时 continue pointer。

当主线 durable checkpoint 改变时，优先更新 `CURRENT_CHECKPOINT.md`；只有恢复协议或主线性质发生变化时才需要改本文件。
