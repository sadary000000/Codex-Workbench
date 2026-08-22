# ARCH-V2-1 Implementation Reality

## Stage

`ARCH-V2-1 Native Equivalence & Optional Feature Isolation`

本文件回答本阶段要求的 Q1–Q7。结论基于当前源码、Codex CLI 0.147.0 协议证据、单元/契约测试，以及隔离真实 App Server smoke；没有把 fake server 结果冒充真实 App Server。

## Q1 — Map activation authority

Conversation Map 的持久化开关事实来自 `ConversationMapCoordinator.status(nativeThreadId)`，其底层是 Workbench-owned `MapStore`。`src/main/map-activation.ts` 只做纯判断：必须同时 `available === true` 且 `enabled === true` 才允许进入 Map sidecar maintenance 生命周期。

当前运行时分成两种能力，不混用：

| 能力 | 权威/来源 | 作用 |
| --- | --- | --- |
| Map sidecar 是否启用 | `ConversationMapStatus` / MapStore | 决定完成事件是否进入有界 Map maintenance |
| Native model-facing dynamic tool | `NativeThreadRuntime.dynamicToolsRegistered` + 真实 `thread/start` 请求 | 只说明该 Runtime 的 `thread/start` 注册过工具 |
| Native Thread identity | Codex App Server 返回的 `nativeThreadId` | 唯一身份，不由 Map 替换 |

MapStore 状态不会单独伪造 Native tool 能力。已有 Runtime 启用 Map 时，主进程会拒绝活动 Turn 中的重挂请求；空闲时关闭旧 transport、以相同 `nativeThreadId` 真实 `thread/resume`，并进入 compatibility maintenance。恢复失败只报告失败，后续仍可用相同 ID 重开。

## Q2 — Why the old `createRuntime` injected `MAP_DYNAMIC_TOOL_SPEC`

此前 `createRuntime` 对所有普通 Thread 无条件传入 `MAP_DYNAMIC_TOOL_SPEC`，导致 Map OFF 的普通 Thread 仍会出现：

- `initialize.capabilities.experimentalApi = true`；
- `thread/start.dynamicTools`；
- Map developer hint；
- Map server-request 路由。

这违反了 Optional Feature Isolation。现在普通 `createNativeThread` 明确以 `mapEnabled: false, mapToolEnabled: false` 创建；`createRuntime` 只有显式 `mapToolEnabled` 才构造 model-facing dynamic tool。当前正常用户启用已有 Thread 的路径使用 compatibility maintenance，因为 `thread/resume` 没有动态工具注册字段。

## Q3 — `thread/start` / `thread/resume` 的真实条件

真实协议边界如下：

| 路径 | `experimentalApi` | `dynamicTools` | Map 结果 |
| --- | --- | --- | --- |
| 普通 Map OFF `thread/start` | `false` | 缺省 | 原生等价基线 |
| 显式 Map ON `thread/start` | `true` | 由调用方显式注册 | 原生 Map tool 可用 |
| 既有 Thread `thread/resume` | `false`（本阶段不宣称注册） | 不发送 | compatibility fallback |

`thread/resume` 只保留受当前 CLI ABI 支持的 `threadId` 与 bounded developer hint；不再发送 `dynamicTools`，也不把配置数组长度当作已注册能力。恢复 Runtime 的 `dynamicToolsRegistered` 保持 `false`，于是 Project/Conversation Map 必要时使用独立、有界、短生命周期 maintenance Thread。

## Q4 — `experimentalApi` 的因果关系

`experimentalApi` 的唯一启动因果是：本次 `thread/start` 是否携带 dynamic tool。普通 Thread 的空数组和缺省值都得到 `false`；显式 dynamic tool 的新 Thread 得到 `true`。恢复路径即使配置层知道 Map sidecar 已启用，也不会把 `experimentalApi` 伪装成可注册工具，因此得到 `false`。

## Q5 — Conversation/Project Map 的额外 Runtime

额外 Runtime 只存在于显式 Map maintenance 路径：

- Conversation Map resumed compatibility fallback：临时 `AppServerProcessClient`，只接收当前 Turn 的 bounded delta 与节点摘要；不读取完整历史，不进入普通 Thread projection。
- Project Map maintenance Runtime：由 `ProjectMapManager.updateFromDelta` 或启用后的显式 `maintenanceRead` 懒加载；使用独立 binding，不写入普通 Thread/Recent/Pinned；Map OFF 的 `maintenanceRead` 现在 fail-closed，不创建 Runtime。

Map OFF 的普通 Native Turn 不触发 Map tool、Map patch 或 Map-only maintenance Turn。Project 成员完成回调最多保留 bounded dirty/status 检查，不会在 OFF 状态创建额外 App Server。

## Q6 — Model-facing capability vs projection/maintenance

Map sidecar、Map projection、source trace 和 Native model-facing tool 是不同边界：

```text
Native Thread / Turn / Item
        │ authoritative runtime facts
        ├── ordinary answer projection
        └── optional Map sidecar
                ├── persisted Map JSON
                ├── bounded source trace
                └── explicit maintenance/fallback
```

Map 不成为第二 Conversation/Transcript truth。Map patch 失败不会替换普通回答；maintenance Thread 的 ID 不进入普通 Thread 导航；所有 source 保留原 Native Thread/Turn/Item 定位。

## Q7 — Map ON vs Map OFF tests

### Map OFF

- Native runtime unit test：`experimentalApi=false`、`thread/start` 不含 `dynamicTools`/developer hint、`dynamicToolsRegistered=false`。
- 普通 Thread 创建路径显式关闭 `mapEnabled/mapToolEnabled`。
- Project Map disabled `maintenanceRead` 以 `PROJECT_MAP_NOT_ENABLED` fail-closed。
- Renderer 不再把 OFF 显示成“已为新 Thread 注册”，而是显示“原生 Map 能力未注册”。

### Map ON

- 新 Thread dynamic-tool unit/real smoke：真实 `workbench_map_patch` 1 次，Map revision `0→1`。
- Resumed Thread real smoke：`resumeParamsHadDynamicTools=false`、`sameTurn=compatibility_fallback`，独立 maintenance tool 1 次，revision `0→1`。
- Project Map real smoke：两个成员 Thread、独立 maintenance Thread、context request 1 次，重启后 revision `2→3`，maintenance Thread 不进入普通导航。

## Reality conclusion

`Native Equivalence` 的 Map OFF model-facing delta 已闭环；Map ON 保留真实新 Thread 原生能力和既有 Thread 的显式 compatibility fallback。没有 Shared CodexHost、Provider、Automation 或新 Conversation truth 实现。本阶段不进入 ARCH-V2-2。

