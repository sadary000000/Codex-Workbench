# Phase 6：Map 产品实现记录

日期：2026-08-17
状态：实现完成，等待 GPT Gate 审查

## 用户可见能力

- Native Thread Workspace 继续作为主界面；Map Panel 默认关闭，按需打开；
- Conversation Map 可独立 enable、pause、resume，并显示同步状态；
- Map 以树状节点显示 planned / in_progress / completed / blocked；
- 节点可以显示冻结/进行中/完成/阻塞标记，并从来源跳回 Native turn/item；
- Map 更新失败不会清空普通回答，状态会保留 error 或 dirty，便于继续处理；
- Project Map 使用独立 sidecar 和维护绑定，不污染正常 Conversation、Recent 或 Project 导航。

## 工程变更

| 层 | 变更 |
| --- | --- |
| Shared | `map-types.ts`、`map-store.ts` 提供版本化模型、校验、幂等、原子持久化 |
| Codex | `map-tool.ts` 定义真实 App Server 动态工具协议；新 Thread 注册，resume 不伪装支持 |
| Main | Conversation coordinator、Project Map manager、IPC 路由和 Native 事件接线 |
| Preload | 暴露受限的 Map status/control/state API |
| Renderer | 三列/移动 Drawer Map Panel、树和 source jump |
| Tests | Map schema/store/coordinator 与 Native dynamic tool registration 覆盖 |

## 当前验证门槛

已完成一次真实 CLI smoke：新 Thread 注册 dynamic tool、实际收到 1 次 `item/tool/call`、Map patch 成功落盘并完成普通 Turn；该 smoke 使用 ephemeral Thread，CLI 明确不允许对其调用 `thread/delete`，由 ephemeral 语义保证不持久化。Gate 前还要完成最终 build、diff/秘密扫描和 donor 不变核对。真实 smoke 只作为能力证据，不得因为网络、账号或服务端限制而把失败包装成成功。

## 下一步 Gate

向 GPT 提交 `[CODEX_WORKBENCH_STAGE_REVIEW]`，附 commit、命令输出摘要、审计代理结果、已知限制和旧 donor 状态，请求 `PASS / FIX / REDESIGN / BLOCKED`。在收到审查结论前不进入 Phase 7。
