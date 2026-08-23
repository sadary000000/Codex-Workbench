# ARCH-V2-5 Test Override Evidence

测试/运行时 override 通过 `applyHardConstraintOverride(base, override)`，输出仍是
immutable HardConstraints。测试证明可以把 prompt 上限收紧、删减操作，但扩大预算、打开
side effects 或移除 Human Gate 会抛出 `POLICY_INPUT_INVALID`。

本阶段没有读取环境变量来放宽限制，也没有把测试预算写入生产 Automation DB。
