# Workbench 新对话交接入口

本文件是新 ChatGPT / Codex 会话进入 Workbench 项目的固定入口。它只保存恢复协议；实时状态以 Git / PR / CI 和 `CURRENT_CHECKPOINT.md` 指向的 durable checkpoint 为准。

## 最短恢复顺序

1. 读取 `docs/workbench-map/HANDOFF.md`；
2. 读取 `docs/workbench-map/CURRENT_CHECKPOINT.md`；
3. 读取 `CURRENT_CHECKPOINT.md` 指向的 primary durable checkpoint；
4. 核对 live Git refs、PR、exact product SHA 和最新 CI；
5. 从 durable checkpoint 的 `Immediate resume sequence` 直接继续。

只有需要长期约束时再读取：

- `docs/V0.1-MVP-SCOPE-FREEZE.md`
- `docs/workbench-map/ARCHITECTURE.md`
- `docs/workbench-map/GIT_WORKFLOW.md`

不要先从旧 Roadmap 或历史测试结果推断今天的继续点。

## 当前主线提示

当前工作流仍是冻结的 **v0.1 Recovery Closure**：

- product branch: `fix/v01-recovery-closure`
- integration base: `release/v0.1-integration`
- product PR: Draft PR #55 -> `release/v0.1-integration`
- exact product snapshot currently under validation: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`

注意区分：

- **branch HEAD**：可能继续包含 docs-only checkpoint / coordination / maintenance commits；
- **product snapshot**：真正接受某一轮产品验证结论的代码 SHA。

任何新会话都必须重新查询 live Git/PR/CI，不能把本文件中的 SHA 当永久事实。

旧 CI carrier PR #56 已关闭且未合并，`ci/v01-recovery-closure` 分支已不存在。Exact-SHA CI 使用 `.github/workflows/ci.yml` 的 `workflow_dispatch` + `ref`；不要重建 CI helper branch。

## 当前验证提示

最近已知的 Recovery 验证仍未通过：同一 exact product SHA `1e9d2ea...` 的 CI run `33649460705` 在 Unit/integration tests 阶段连续两次失败；第二次 rerun job 为 `100525705853`，Build 因此 skipped。

所以当前状态仍是 **IN PROGRESS / NOT RELEASE READY**。不要把旧 Source Real E2E、旧 Windows artifact 或 pre-Recovery PASS 当作当前 Recovery snapshot 的发布证据。

## Resume Protocol

新会话恢复后：

1. 先以 Git / PR / CI 修正任何过时文档认知；
2. 不重新规划整个项目，不扩大已经冻结的 v0.1 scope；
3. 当前首要任务是拿到/复现 Unit/integration 的 exact failing assertion，再做最小修复；
4. stale StepRuntime `terminalResult` 目前只是未验证 debugging lead，不得直接当根因；
5. deterministic CI 全绿后，固定继续顺序：`crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression`；
6. 所有门禁通过前，不 merge PR #55、不标 Ready、不宣布 release ready。

长期不变量保持不变：Native Thread/Turn/Item 是 Native execution truth；Workbench 不复制第二 transcript/sandbox/runtime；uncertain external side effect 必须 Reconcile before repeat；Evidence 必须来自真实执行/验证事实。

## 新对话启动指令

```text
继续 Workbench
```

收到该指令后，按本文件 -> `CURRENT_CHECKPOINT.md` -> primary durable checkpoint -> live Git/PR/CI 的顺序恢复，并直接执行 `Immediate resume sequence`。
