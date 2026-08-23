# ARCH-V2-8 Frozen Contract Check

## 结论范围

本检查确认 ARCH-V2-7 之后的架构不变量是否仍被当前源码、测试和 package provenance 支持。它不是把所有 real runtime 证据自动升级为 PASS。

## Truth ownership

| 事实 | 唯一来源 | Workbench 角色 | 结果 |
|---|---|---|---|
| Native Thread identity | Codex App Server / Native Runtime | projection/binding | PASS |
| Native Turn / Native Item | Native Runtime | UI projection | PASS |
| App Server runtime lifecycle | Codex App Server | adapter/client | PASS_WITH_LIMITATION |
| V1 project/thread/composer/recovery metadata | V1PersistenceStore | minimal persistence/recovery | PASS |
| Automation entities | AutomationStore / SQLite | explicit domain boundary | PASS |
| WebGPT request facts | provider-local Request Journal | request/recovery facts only | PASS |
| WebGPT Project/Role binding | provider-local registries | provider boundary | PASS |
| UI transcript reconstruction | no independent store | forbidden second truth | PASS |
| Workflow/task/agent lifecycle | no V1 replacement | out of scope for this stage | PASS |

## Contract assertions

- 不建立第二套 Conversation truth：PASS。
- 不建立独立 Transcript truth：PASS。
- 不以 Request Journal 重建 Workflow truth：PASS。
- 不以当前浏览器页面代替 Project/Role binding：PASS。
- 不静默替换 Native Thread identity：PASS。
- PromptRecovery 持久化为 hash/length/ref 边界，不以 raw Prompt 作为 canonical recovery truth：PASS。
- Migration/query/read 与显式 write boundary 分离：PASS_WITH_LIMITATION，V2-7 isolated harness 已覆盖，完整生产 rebuild command 仍是 debt。
- ARCH-V2-8 未修改 V1 Frozen Core：PASS，当前阶段只新增审查文档/审查包。

## Compatibility exceptions requiring GPT decision

1. Installed App Server userAgent is Codex Desktop 0.148.0-alpha.9 while Workbench verified allowlist is 0.147.0.
2. Packaged official CLI status smoke returned a bounded TIMEOUT.
3. These exceptions are evidence, not silently accepted limitations; no source fix is included in ARCH-V2-8.
