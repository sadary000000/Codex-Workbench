# Architecture Baseline V2 — Final Review Candidate

## 状态

这是 ARCH-V2-8 的最终架构基线候选稿，状态为：

READY_FOR_GPT_FINAL_REVIEW

它不是 FINAL_FROZEN。只有 GPT Gate 通过并且用户明确确认最终冻结后，才允许写入 FINAL_FROZEN。

## Frozen core

Native Thread -> 唯一 Conversation identity

Native Turn / Native Item -> 唯一消息与运行事实

Codex App Server -> Native runtime 主路径

Workbench 是产品壳、UI projection、最小 persistence/recovery 和 Map enhancement；不建立第二套 Conversation truth、Transcript truth、Task truth、Agent lifecycle truth、Context truth 或 exec-history reconstruction。

## V2 extension boundary

V1 Frozen Core
  |
  +-- WebGPT provider feature
  |     +-- Electron browser runtime
  |     +-- Project / Role registries
  |     +-- Request Manager / Journal
  |     +-- Control Plane / CLI
  |
  +-- Automation domain
        +-- AutomationStore / SQLite
        +-- Requirement / Plan / Stage / Step contracts
        +-- Intent / Attempt / Receipt / Evidence
        +-- EffectivePolicy
        +-- provider-neutral port

WebGPT Request Journal 只能保存 provider-local request/result facts；AutomationStore 才是 Automation domain 的 canonical store。两者不能互相冒充 Workflow 或 Conversation truth。

## Required review decisions

GPT 需要裁决以下是否阻断当前最终冻结：

- production startup 是否必须达到 operational idle zero-cost；
- shared AppServerHost 是否必须在生产路径强制版本/hash handshake；
- diagnostics、migration、policy initialization 是否必须从普通启动路径剥离；
- Recovery Intent 是否必须接入真实 side-effect bridge；
- candidate recovery、identity preservation、policy pin mismatch 的 P1 发现是否需要下一轮修复；
- installed Desktop App Server 版本漂移和 packaged CLI timeout 如何处理。

## Explicit non-claims

- 不宣称跨 provider exactly-once。
- 不宣称未执行的真实 Thread/Turn business flow。
- 不宣称 isolated projection rebuild 等价于完整 production rebuild command。
- 不宣称现有本地 dirty workspace 是可复现 clean release snapshot。
- 不宣称 ARCH-V2-8 已 FINAL_FROZEN。
