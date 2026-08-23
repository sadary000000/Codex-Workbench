# ARCH-V2-4 FIX ROUND 1 — Implementation Record

## Authorized scope

本轮授权来自上一轮 GPT Gate 的 FIX-01～FIX-08。实现边界是 External Action / Resource / Reconciliation Integration；没有重做 RuntimeRegistry、Native Thread truth、Map、Renderer、Shared Host 或 Automation 产品层。

## Changes

1. `control.auto` 只处理 live OperationArbiter control ownership/queue transition；历史 reconcile 保留为显式操作。
2. 真实 control/arbiter smoke 在无 Prompt 条件下重跑；脚本的 nullability/公开错误码断言只做机械性收口。
3. 由现有 Arbiter snapshot 派生 live lease，并经 RequestManager adapter 映射到 ProviderRequest、ExternalRef、ResourceClaim。
4. accepted provider side effect 的本地关联写入失败进入 UNKNOWN/RECOVERY_REQUIRED；reconcile 使用既有 ProviderRequest，不调用 submit。
5. 新增 `buildWebGptDispatchContext()`，复用既有 readiness classifier 与 authoritative facts；`canDispatch()` 仍为纯函数。
6. 正常 observation 和 explicit reconcile 的 reconcileState 分离。
7. 以当前真实 Journal 作为 baseline，不 rollback、不清除、不猜测历史。

## Review posture

自动 Gate 通过；Bridge 级 reattach 和标准 package 文件锁等问题以证据提交 GPT，未在本轮继续扩大修复。
