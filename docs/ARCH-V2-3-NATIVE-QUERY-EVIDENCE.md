# ARCH-V2-3 Native Query Evidence

## Scope

本证据只覆盖 Native Thread 查询与本地 projection 的副作用边界，不改变 Codex App Server 的 Native Thread/Turn/Item 事实所有权。

## Before / after

| Path | Before | After |
|---|---|---|
| `NativeThreadRuntime.readThread()` | `thread/read` 成功或失败后都可能写 ThreadProjection | 只读取 App Server；错误只更新当前 Runtime 的 fail-closed 内存状态 |
| Projection refresh | 与 query 隐式耦合 | 由 `refreshProjectionFromRead(read?)` 显式触发 |
| Main IPC `native-runtime:read` | no-rollout 分支可把本地 projection 标成 unavailable | 只返回读取结果/错误；显式导航或恢复生命周期负责持久化 unavailable |

## Evidence

- `tests/native-thread-runtime.test.ts`: `Native readThread is query-only and projection refresh is explicit`
- `tests/native-thread-runtime.test.ts`: `Native readThread error is fail-closed without rewriting the projection`
- `npm test`: these tests pass in the final `308/308` run.

## Boundary

`readThread()` 不创建替代 Thread、不改 `nativeThreadId`、不伪造历史。需要刷新非权威 projection 时，调用方必须进入显式 refresh/navigation/recovery 路径。
