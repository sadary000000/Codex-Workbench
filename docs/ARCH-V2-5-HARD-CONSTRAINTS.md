# ARCH-V2-5 Hard Constraints

`DEFAULT_HARD_CONSTRAINTS` 是当前产品硬边界：PROMPT=12、REPAIR=3、RETRY=3、NEW_CHAT=3；
默认禁止 data egress 和 side effects，并把 SIDE_EFFECT 设为 Human Gate 语义。硬约束与
PolicyVersion、RuntimeCapability 分开输入，resolver 只取交集。

`applyHardConstraintOverride` 是唯一的测试/runtime override 路径。它拒绝预算扩大、
操作扩大、移除既有 Human Gate 以及打开 data egress/side effects。没有把任意配置文件或
环境变量提升为产品硬约束源。

证据：`src/automation/effective-policy.ts:207-261`，`tests/arch-v2-5-policy.test.ts` 的
hard deny/override/Human Gate cases。
