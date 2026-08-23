# ARCH-V2-4 FIX ROUND 1 — GPT Gate Review Request

> **Current review request:** Use `ARCH-V2-4-GPT-REVIEW-ROUND-2.md` and `ARCH-V2-4-FIX-ROUND-2.md`. The Round 1 request below is retained only as prior-gate context.

上一轮 Gate 为 `FIX_REQUIRED (P0=3, P1=3, P2=1)`。本轮只执行 Required Fixes 01～08；请基于 Review Package 中的 PASS/FAIL_WITH_EVIDENCE 给出新的 Gate。

请重点审查：

1. `control.auto` 是否已与 historical reconcile 分离，且真实 safe smoke 的 Journal before/after 是否保持不变；
2. production OperationArbiter live lease 是否真正进入 ProviderRequest/ExternalRef/ResourceClaim correlation；
3. provider accepted + local persistence failure 是否 UNKNOWN/recovery-only 且禁止 redispatch；
4. dispatch context 是否来自现有 scope-aware classifier 与 authoritative runtime/target/live facts；
5. Bridge 级 same-semantic reattach 缺口是否需要当前阶段 Required Fix；
6. normal terminal observation 与 explicit reconcile 的 `NOT_REQUIRED/RECONCILED` 语义；
7. Journal 事故证据是否被保留且未猜测恢复；
8. ARCH-V2-1/2/3 regression、测试、package provenance 是否足够；
9. 仍存在的 Provider identity、ResourceClaim lifecycle、production wiring 风险是否属于当前阶段。

```text
Gate:
PASS | FIX_REQUIRED | BLOCKED

Findings:
P0/P1/P2

Required Fixes:
仅给 ARCH-V2-4 当前范围内下一轮最小修复；不要假设 Codex 已自行修复未授权问题。

Architecture decision:
若 PASS，请给出下一阶段完整唯一执行指令；若 FIX_REQUIRED，请给最小 Required Fixes；只有确实需要用户不可替代权限/决策时才 BLOCKED。
```
