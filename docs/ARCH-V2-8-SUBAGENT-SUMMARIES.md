# ARCH-V2-8 Subagent Summaries

## 生命周期

- ARCH-V2-8 要求的 5 个独立审计代理均已派出。
- 当前工具状态：running_subagents = 0；没有仍在运行的代理。
- A–D 的结果可取回并已由主 Agent 审核；E 未返回可取回的结果，状态查询为 not_found，结论不采用。
- 本阶段没有代理修改产品代码、提交、触碰旧 donor 或 Auto_Agent，没有发送业务 Prompt 或创建业务 Chat。

## A — Capability / Protocol

结果：协议生成与 resolver 选定的 codex-cli 0.147.0 证据通过；发现 P1：共享 AppServerHost 启动路径没有强制执行版本/hash 校验，且部分 production path 使用 skipInitialize。A 还确认 status/schema 不是当前 stable App Server 可用 RPC，schema 中对应状态是 notification/能力差异。

采用：

- 作为 capability/protocol evidence。
- 作为“实际 Desktop 0.148.0-alpha.9 不等于 Workbench resolver 选定 0.147.0 binary”的解释补充。

不直接采用：

- 将 resolver 未选中的 Desktop binary 当作唯一 production binary。
- 将未执行的 live Thread/Turn 说成真实 PASS。

## B — Frozen Boundary

结果：源码级 regression 377/377；严格冻结边界挑战发现：

1. 普通启动仍初始化 Automation、Policy、WebGPT session/control plane，可能违反可选能力 idle zero-cost 边界，列为 P0 challenge。
2. activeSummary() 对非 live 状态的暴露需复核，列为 P1。
3. Provider Port 的 production resolveInputRef 仍可能未闭合，列为 P1。
4. 没有完整生产 projection rebuild，只有 isolated evidence。
5. legacy URL-shaped bridge/AUT/test seam 仍存在。

这些发现不是本轮修复结果，需由 GPT 决定是否属于当前冻结阻断。

## C — Compatibility Regression

结果：独立审计执行 ARCH-V2-1~V2-7 分组回归，报告总计 584 个断言覆盖；npm test 377/377，check、audit、diff、build/package 均通过。没有新增 P0/P1。该结果只证明回归矩阵，不覆盖 B/D 的架构挑战项，也不覆盖真实业务 Prompt。

## D — Persistence / Recovery / Side-effect

结果：30/30 targeted、377/377 full test；发现 5 项 P1、1 项 P2：

1. production startup 通过 diagnostics 触发隐式 persistence/migration side effect。
2. 新 candidate 无效时没有证明回退到较旧有效 candidate。
3. identity preservation 只比较有限 ID/correlation 字段，不是 raw source 到 target 的完整语义证明。
4. intent 与 attempt 的 policy pin 不一致时未明确 fail-closed。
5. Recovery Intent classifier 尚未证明已接入 production side-effect bridge。
6. 完整 production projection rebuild 和 user-facing migration command 未实现，列为 P2。

这些发现全部保留为 GPT review evidence，未擅自修复。

## E — Independent Final Challenge（重跑）

结果：重启 Maxwell 实例后完成独立挑战，结论为 NOT_READY，建议允许提交带阻断项的 GPT Final Review，但不建议 FINAL_FROZEN 或 production READY。

确认的 P0：

1. 普通启动不满足严格 idle zero-cost：main startup 无条件初始化 Automation persistence、policy authority、provider port；相关 store/provider 构造会创建目录、writer lock、SQLite 或 WebGPT workspace。

确认的 P1：

1. 共享 AppServerHost 未覆盖所有路径的 version/hash handshake；存在 skipInitialize。
2. Control Plane capability 只协商，不按 command 执行授权 enforcement。
3. migration candidate 失败后未证明回退到较旧有效 candidate。
4. identity preservation 只比较有限 ID/correlation 字段，不能证明完整 source-to-target 语义保持。
5. Recovery Intent 尚未证明接入 production side-effect bridge，且 production resolveInputRef 仍可能 fail closed。
6. activeSummary 将 RECOVERY_REQUIRED/INDETERMINATE 等非 terminal 状态暴露为 active，可能混淆历史恢复记录和 live resource。

P2：

- 没有完整 production projection rebuild command。
- 没有 user-facing migration command；legacy URL-shaped bridge/test seam 继续保留为后续边界债务。

E 同时确认：npm test 377/377、审查 ZIP 与 sidecar hash 一致；没有发送业务 Prompt、创建业务 Chat 或读取敏感会话数据。

采用：上述 P0/P1/P2 作为最终 challenge evidence；与 A–D 交叉确认的部分提高审查置信度。E 的 policy-pin 结论对 D 的“整体失败”进行了部分反证：新 provider-neutral seam 已有 fail-closed 校验，但 production provider path 尚未完整接通，因此整体仍不升级为 PASS。

Gate 前运行代理数为 0。
