# ARCH-V2-8 Capability Matrix — Reconciled

```yaml
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
technicalGate: FAIL_WITH_EVIDENCE
finalFrozen: false
P0: 0
P1: 5
P2: 3
```

## Status vocabulary

| 状态 | 含义 |
|---|---|
| `SUPPORTED` | 当前代码、协议证据和允许的 smoke 直接支持。 |
| `SUPPORTED_WITH_COMPATIBILITY_PATH` | 能力存在，但必须经过 provenance/initialize/version/capability 门禁。 |
| `UNSUPPORTED` | 当前观察到的版本/能力不在 verified contract 内，生产路径拒绝继续。 |
| `TEST_ONLY` | 仅有源码、contract 或无业务副作用测试证据，未宣称生产 real business。 |
| `PAUSED_NOT_EXECUTABLE` | 因本阶段安全边界或阶段暂停，当前不执行。 |

## Matrix

| 能力 | 当前状态 | 证据/边界 |
|---|---|---|
| `codex-cli 0.147.0` resolver provenance | `SUPPORTED` | 当前 resolver 与 verified binary hash。 |
| App Server stdio launch | `SUPPORTED_WITH_COMPATIBILITY_PATH` | 先 provenance，再 initialize；不匹配时 fail-closed。 |
| `initialize` response validation | `SUPPORTED_WITH_COMPATIBILITY_PATH` | shared validator 存在，但生产 map/project-map raw paths 绕过它。 |
| strict protocol/version compatibility gate | `UNSUPPORTED` | 缺失 protocolVersion 可被接受，未按期望值严格比较。 |
| requested `experimentalApi` capability gate | `UNSUPPORTED` | requested capability 未在所有生产路径形成统一拒绝门禁。 |
| per-command required capability gate | `SUPPORTED_WITH_COMPATIBILITY_PATH` | modern path 有 gate；legacy compatibility path 可绕过。 |
| all production App Server paths use shared gate | `UNSUPPORTED` | `src/main/map-coordinator.ts` 与 `src/main/project-map-manager.ts` 存 raw initialize bypass。 |
| bounded `webgpt.status` | `SUPPORTED` | JSON/exit/error envelope 稳定；未认证状态可为 `UNAVAILABLE`。 |
| `thread/start`, `thread/read`, `thread/resume` | `TEST_ONLY` | contract/adapter 证据存在，本轮不读取真实业务 Thread。 |
| `turn/start`, `turn/interrupt` | `TEST_ONLY` | contract/adapter 证据存在，本轮不发送业务 Prompt。 |
| Native Thread identity boundary | `SUPPORTED` | Native identity 仍是唯一 Conversation identity。 |
| V1 Frozen Core boundary | `SUPPORTED` | 本轮 `v1FrozenCoreChanged=false`。 |
| Recovery reattach/reconcile/no-resend production side-effect path | `UNSUPPORTED` | Provider Port/resolve ref 存在，但 production bridge/submit/recover wiring 未闭合。 |
| production migration identity assertion | `UNSUPPORTED` | identity map 覆盖字段多于 migration contract，调用点未 assert preserved identity。 |
| observed `Codex Desktop/0.148.0-alpha.9` | `UNSUPPORTED` | 不在当前 0.147.0 verified allowlist；不静默升级。 |
| legacy URL-shaped seam | `TEST_ONLY` | `LEGACY_READ_ONLY`，不作为生产事实源。 |
| real business Prompt / new business Chat | `PAUSED_NOT_EXECUTABLE` | 本阶段硬约束为 0。 |
| AUT-2 / AUT-3 | `PAUSED_NOT_EXECUTABLE` | 不进入 Automation Gate。 |

## Conclusion

当前技术门禁不能进入最终人工 Freeze，必须将上述 5 个 P1 连同证据交 GPT。`SUPPORTED_WITH_COMPATIBILITY_PATH` 不等于所有生产路径均已覆盖；所有 `TEST_ONLY` 和 `PAUSED_NOT_EXECUTABLE` 项均保持明确边界。
