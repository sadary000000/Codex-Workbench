# ARCH-V2-5 Runtime Capability

Runtime capability 是 resolver 的独立输入，包含 capabilityVersion、runtimeId、状态
`READY|WAITING|UNAVAILABLE`、支持操作和 data-egress/side-effect flags。WAITING 产生
`WAITING_EXTERNAL`，不可用/不支持产生 `UNSUPPORTED`；调用方不能用 PolicyVersion 绕过
runtime capability。

证据：`src/automation/effective-policy.ts:130-141,262-286,348-434`；targeted test 覆盖
WAITING 和 UNSUPPORTED。
