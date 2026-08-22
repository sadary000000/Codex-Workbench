# ARCH-V2-1 Map Activation Contract

## Contract

1. `Native Thread`、`Native Turn`、`Native Item` 仍是唯一运行事实。
2. MapStore 是 Map sidecar 的持久化事实；它不能单独证明 Native model-facing tool 已注册。
3. `dynamicToolsRegistered === true` 只允许由成功的 `thread/start` dynamic tool 注册路径产生。
4. `thread/resume` 当前不接受 `dynamicTools`；恢复既有 Thread 必须保留 `dynamicToolsRegistered === false`，必要时走 compatibility maintenance。
5. Map OFF：普通新 Thread 不发送 Map tool、Map hint 或仅由 Map 开启的 `experimentalApi`。
6. Map enable 作用于空闲 Runtime；活动 Turn 期间返回 `MAP_RUNTIME_BUSY`，不强制关闭或切换 Turn。
7. 已加载 Thread 启用 Map 后，保持同一 `nativeThreadId`，真实 reopen/resume，sidecar 进入 compatibility maintenance；不创建替代 Thread。
8. Map patch 是可丢弃/可重建投影；删除 Map cache 不改变 Native truth。

## Lifecycle matrix

| 场景 | Sidecar | Runtime | Model-facing tool | 完成后处理 |
| --- | --- | --- | --- | --- |
| 普通新建 | OFF | start | 无 | 无 Map maintenance |
| 普通已存在、Map OFF | OFF | resume | 无 | 无 Map maintenance |
| 已存在 Thread 启用 Map | ON | same-ID resume | 无（ABI 限制） | bounded compatibility fallback |
| 新 Thread 原生 Map smoke | ON | thread/start | `workbench_map_patch` | direct patch |
| Project Map 显式 update | ON | 独立 maintenance Runtime | Map + context tool | Project sidecar only |
| Map paused | ON/paused | 普通 Runtime 继续 | 不改变 | dirty，不推进 cursor |

## Fail-closed rules

- 不因 Map 状态改变 `nativeThreadId`。
- 不静默创建替代 Thread。
- 不把 maintenance Thread 放进普通 Recent/Project Thread 列表。
- 不把 Map patch、source cursor 或 cache 当作 Transcript truth。
- 不在 Project Map OFF 时创建 maintenance Runtime。
- 不把 resume 配置字段长度误报为协议已注册能力。

