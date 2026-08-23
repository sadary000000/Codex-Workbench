# ARCH-V2-5 Human Gate Evidence

Human Gate 是 `resolveEffectivePolicy` 的明确 `REQUIRE_HUMAN_GATE` decision，并在 evidence
中保留 operation、policyVersionId、correlation/action identity 和 reason。它不是从
`sideEffectClass`、UI 点击或模型文本隐式推断。

默认 HardConstraints 不允许 side effect；即使策略和 runtime 都声明支持，仍必须通过
硬边界且显式 Human Gate。targeted test 验证了这一顺序。
