# ARCH-V2-5 Implementation Reality

## Scope

```yaml
stage: ARCH-V2-5
name: PolicyVersion Resolver / Hard Constraints / Budget Authority
base_commit: 191557e96238c1b9322ae74cca156245bfd77e5d
v1_frozen_core_changed: NO
automation_business_execution_added: NO
real_business_prompts: 0
```

本阶段把现有 `PolicyVersion` 记录解析为有界类型视图，并提供
`HardConstraints ∩ PolicyVersion ∩ RuntimeCapability` 的唯一解析入口。策略仍然只由
`automationProjects.policyVersionId -> policyVersions` 这条持久化关系承载；新增的
`EffectivePolicy`、`PolicyPin` 和 `PolicyBudgetAuthority` 是运行时视图/租约，不是第二套
持久化事实源。

## Implemented

- `src/automation/effective-policy.ts`：硬约束、策略版本视图、RuntimeCapability、决策证据、pin 和四类预算 Authority。
- `src/automation/store.ts`：typed PolicyVersion 校验、同项目版本链、不可变替换、当前策略解析、当前策略 pin，以及 ActionIntent/Checkpoint 自动绑定。
- `src/automation/schema.ts` / `src/automation/sqlite-persistence.ts`：策略版本与 pin 的项目边界、父 ActionIntent 一致性和严格持久化边界。
- `src/automation/requirement-webgpt-adapter.ts`：支持注入共享 repair budget authority；旧 `{used,max}` 接口保留兼容。
- `tests/arch-v2-5-policy.test.ts`：解析、硬约束不可放宽、Human Gate、pin、预算去重、持久化和 ActionIntent/Checkpoint pin 契约。

## Actual activation boundary

新建 ActionIntent、ActionAttempt、Checkpoint 会记录当前 PolicyVersion identity；Requirement
repair adapter 可以注入 `PolicyBudgetAuthority`。历史 AUT harness 的真实 prompt/new-chat
计数仍是既有测试/真实 Gate 的输入，不在本阶段静默改写，也没有把 ARCH-V2-5 伪装成
Automation 已正式执行。下一阶段若要把所有业务入口切换到 Authority，必须在 GPT Gate
明确授权后进行并保留各入口的 correlation identity。

## Safety

- policy version 只能通过新版本 supersede，不能原地覆盖。
- pin 的 project/id/version 不一致时 fail closed。
- test/runtime override 只能收紧预算、操作集合或能力边界，不能放宽 HardConstraints。
- 默认 `allowDataEgress=false`、`allowSideEffects=false`；SIDE_EFFECT 即使被列入语义集合仍需 Human Gate 且默认被硬约束拒绝。
- 不持久化 prompt、response、transcript、cookie、token、password、raw body 或 browser profile。

## Known limitations

- 生产 WebGPT/AUT 全部入口尚未切换为该 Authority；这是有意保留的 scope boundary，不声称完成业务层迁移。
- legacy ActionIntent/ActionAttempt/Checkpoint 可以没有 `policyVersionId` 以保持读取兼容；新的 resolver 对缺失/不匹配 pin 采取 fail-closed。
- 真实 smoke 使用既有无 prompt Control Plane protocol evidence；本阶段没有发送真实业务 Prompt。
