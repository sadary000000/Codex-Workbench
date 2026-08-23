# ARCH-V2-5 Budget Authority

`PolicyBudgetAuthority` 对 `PROMPT`、`REPAIR`、`RETRY`、`NEW_CHAT` 使用同一个
`EffectivePolicy` snapshot。`reserve` 在 dispatch 前占用一次；相同 kind/correlation
重复预约被拒绝；成功后 `commit` 不可回收，未发送且明确失败时才可 `release`。

Authority 返回 bounded decision/reason/remaining/policyVersionId，不保存 prompt 或 response。
Requirement adapter 支持注入 Authority；旧 repair `{used,max}` 参数只为兼容历史 ABI，尚未
替换全部 AUT/CLI 业务入口（已记录为 scope limitation）。

证据：`src/automation/effective-policy.ts:438-503`、`src/automation/requirement-webgpt-adapter.ts:149-205`。
