# ARCH-V2-4 Out-of-Scope / FAIL_WITH_EVIDENCE Findings

本文件保留本轮审计发现但未自行扩大修复范围的问题，交由 GPT 决定下一轮 Required Fixes。

## Bridge reattach gap

`classifyWebGptActionReadiness()` 可以识别 `reattachRequestId`，但当前 `buildWebGptDispatchContext()` 不携带它，`WebGptExternalActionBridge.dispatch()` 仍会创建新的 `ActionAttempt`。RequestManager 层 same-key/same-semantic retry 已证明不重复发送，但 Bridge 层“复用既有 Attempt/ProviderRequest”的直接证据缺失。该项对应 FIX-05 的 `FAIL_WITH_EVIDENCE`，本轮不自发设计第二轮修复。

## Provider/lease identity hardening not expanded

独立审计建议后续明确校验 Provider observation 的 request/target/semantic identity，校验 ExternalRef kind/project/provider，且明确 ResourceClaim 的历史 correlation 与 live lease 的生命周期收束。当前唯一 live lease truth 仍是 `OperationArbiter`，没有新增第二 lease store；这些建议未在本轮自行实现。

## Production composition wiring

审计未在 `src/main` 中确认完整 WebGPT External Action Bridge 生产 caller；现有 production adapter composition 与 integration test 已覆盖 Adapter → Arbiter/Provider mapping，但 Requirement/Planner 主流程接线是否属于本阶段，需 GPT 明确，不在本轮自行扩展。

## Journal incident limitation

第一次历史 smoke 的 SHA 变化 `E116...E77B0 → 7D2F...661CE` 已保留为事故证据。没有可信 backup，未执行 rollback/删除/批量 terminalize。当前真实 post-incident baseline 为 `E3A68C5C8ECB52B1DD00C9B79B3FFEC5AEFFEDB03306C18606EDB4F1C0DAEA6B`、118057 bytes；第二次安全 smoke before/after 不变。更早 byte delta 的精确内容不可从现有证据恢复。

## Not in scope

- ARCH-V2-5 PolicyVersion / provider-neutral migration;
- AUT-2/AUT-3/AUT-4+、Planner/Workflow/Scheduler;
- 真实 WebGPT Prompt、真实新 Chat、多账号、多会话;
- V1 Frozen Core、Native Thread/Turn/Item、Map、Renderer、Shared Host redesign;
- 生产 Journal cleanup/migration 或 Automation DB migration。
