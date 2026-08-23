# ARCH-V2-8 Frozen Contract Check — Reconciled

```yaml
technicalGate: FAIL_WITH_EVIDENCE
finalFrozen: false
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
v1FrozenCoreChanged: false
P0: 0
P1: 5
P2: 3
```

## Truth ownership

| 事实 | 唯一来源 | Workbench 角色 | 结果 |
|---|---|---|---|
| Native Thread identity | Codex App Server / Native Runtime | projection/binding | PASS |
| Native Turn / Native Item | Native Runtime | UI projection | PASS |
| App Server lifecycle | Codex App Server | adapter/client with readiness gate | PASS |
| V1 project/thread/composer/recovery metadata | V1 persistence boundary | minimal persistence/recovery | PASS |
| WebGPT request facts | provider-local Request Journal | request/recovery facts only | PASS |
| WebGPT Project/Role binding | provider-local registries | provider boundary | PASS |
| UI transcript | Native items + projection | no independent truth | PASS |
| Workflow/task/agent lifecycle | out of frozen V1 boundary | no replacement truth | PASS |

## Contract assertions

- 不建立第二套 Conversation truth：PASS。
- 不建立独立 Transcript truth：PASS。
- 不以 Request Journal 重建 Workflow truth：PASS。
- 不以当前浏览器页面代替 Project/Role binding：PASS。
- 不静默替换 Native Thread identity：PASS。
- Recovery 只使用 correlation/identity/policy 边界，不以 raw Prompt 作为 canonical truth：PASS。
- migration fallback 在候选无效时 fail-closed，不能 fallback latest：PASS。
- production App Server 路径不允许未经 initialize/provenance 的 ready：FAIL_WITH_EVIDENCE；map/project-map raw paths 绕过 shared validator。
- strict protocolVersion/requested experimentalApi enforcement：FAIL_WITH_EVIDENCE。
- legacy Control Plane per-command capability enforcement：FAIL_WITH_EVIDENCE。
- Recovery Provider Port production side-effect bridge/recover：FAIL_WITH_EVIDENCE。
- production migration identity coverage/assertion：FAIL_WITH_EVIDENCE。
- 本轮产品代码未被 ROUND 2 修改：PASS。

## Historical resolution

ROUND 1 的 blocker findings 标记为 `HISTORICAL_RESOLVED`，当前不再计入 blocker。最终人工确认前只允许 `finalFrozen=false`。

## Deferred contract impact

5 个 P1 是当前阻塞项；三个 P2 仍均 `blocking=false`、`frozen_contract_impact=NONE`，详见 `ARCH-V2-8-DEFERRED-DEBT.md`。当前最终冻结保持 `finalFrozen=false`。
