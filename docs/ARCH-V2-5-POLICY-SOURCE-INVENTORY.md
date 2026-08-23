# ARCH-V2-5 Policy Source Inventory

| 来源 | 位置 | 角色 | 是否唯一事实源 |
|---|---|---|---|
| Project pointer | `src/automation/types.ts:255`, `src/automation/schema.ts:149,634` | 当前项目指向的 `policyVersionId` | 是（指针） |
| Persisted PolicyVersion | `src/automation/types.ts:525`, `src/automation/store.ts:1244-1264` | 有界、不可变策略版本记录 | 是（策略版本） |
| Typed policy parser | `src/automation/effective-policy.ts:291-324` | 从现有记录生成只读 view | 否（派生 view） |
| HardConstraints | `src/automation/effective-policy.ts:207-261` | 产品安全上界；默认源为 `DEFAULT_HARD_CONSTRAINTS` | 否（独立硬边界） |
| RuntimeCapability | `src/automation/effective-policy.ts:130-141,262-286` | 当前 runtime 能力事实 | 否（运行时事实） |
| Effective resolver | `src/automation/effective-policy.ts:348-434` | 唯一交集/决策入口 | 否（计算结果） |
| Budget authority | `src/automation/effective-policy.ts:438-503` | 当前 pinned policy 的运行时预算租约 | 否（运行时计数） |
| Action/Checkpoint pin | `src/automation/store.ts:851-898,1152-1192` | 将执行事实绑定到 policy identity | 否（引用/证据） |

## Source rules

1. 不从当前 UI、调用方 bool、历史 Journal 或 prompt 文本推导 PolicyVersion。
2. `createHardConstraints` 是受控的类型/fixture 构造器；产品默认硬边界是
   `DEFAULT_HARD_CONSTRAINTS`，可变测试配置只能经 `applyHardConstraintOverride` 且只能收紧。
3. `policyVersionPayload` 使用已有 bounded metadata 载体，没有新增第二个数据库。
4. `resolveEffectivePolicy` 的 evidence 必须携带 `policyVersionId`、hard schema、runtime
   capability、decision、reason、operation/correlation/action identity。

## Historical sources intentionally not promoted

- `scripts/aut2-real-webgpt-gate.ts` 中的 real smoke budget counters：保留为 Gate harness
  证据，不作为生产 PolicyVersion source。
- `src/automation/requirement-webgpt-contract.ts` 的旧 repair limit：保留 ABI 兼容；新
  adapter 可使用注入 Authority，但没有把历史协议函数冒充为全局 Authority。
- WebGPT project operation timeout：是 transport/operation deadline，不是 prompt/retry budget。
