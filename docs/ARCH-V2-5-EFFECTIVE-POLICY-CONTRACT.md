# ARCH-V2-5 EffectivePolicy Contract

## Inputs

- `HardConstraints`: 产品不可放宽的安全和预算上界。
- `PolicyVersionView`: 从当前项目唯一 persisted PolicyVersion 解析出的 immutable view。
- `RuntimeCapability`: 当前 runtime 的版本、状态、支持操作及能力边界。
- `PolicyPin`: operation correlation 绑定的 project/policy version identity。

## Output

```yaml
decision: ALLOW | DENY | REQUIRE_HUMAN_GATE | WAITING_EXTERNAL | UNSUPPORTED
effectivePolicy:
  policyVersionId: <id>
  pin: <project/id/version/correlation/timestamp>
  budgets: PROMPT/REPAIR/RETRY/NEW_CHAT
evidence:
  hardConstraintResult: ALLOW | DENY
  capabilityResult: ALLOW | WAITING | UNSUPPORTED
  effectiveDecision: <decision>
  reason: <bounded code>
```

预算取三者交集中的 hard/policy 最小值；操作集合和 data-egress/side-effect 也取交集。
缺少或不匹配 pin 的 in-flight 解析使用 `resolvePinnedEffectivePolicy` 时失败关闭。

## Decision ordering

硬约束拒绝优先；runtime WAITING/UNSUPPORTED 不被调用方策略“放行”；策略操作集合、
数据外发/副作用边界、预算和 Human Gate 再依次收敛。Human Gate 是显式 policy result，
不是通过 actionType 或 UI 猜测。
