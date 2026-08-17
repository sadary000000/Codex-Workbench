# Phase 6：Map 产品实现记录

日期：2026-08-17
状态：Gate Fix 实现完成并获 GPT Gate PASS；Phase 6 已冻结

## 用户可见能力

- Native Thread Workspace 继续作为主界面；Map Panel 默认关闭，按需打开；
- Conversation Map 可独立 enable、pause、resume，并显示同步状态；
- 恢复 Thread 会明确显示兼容维护状态；不把 `thread/resume` 误报为 same-turn dynamic tool 可用；
- Map 以树状节点显示 planned / in_progress / completed / blocked；
- 节点可以显示冻结/进行中/完成/阻塞标记，并从来源跳回 Native turn/item；
- Map 更新失败不会清空普通回答，状态会保留 error 或 dirty，便于继续处理；
- Project Map 使用独立 sidecar 和维护绑定，不污染正常 Conversation、Recent 或 Project 导航。
- Project Map 右侧 scope 支持 Update、dirty/syncing/error、确认原因、跨 Thread source jump 和只读查看维护对话；

## 工程变更

| 层 | 变更 |
| --- | --- |
| Shared | `map-types.ts`、`map-store.ts` 提供版本化模型、校验、幂等、原子持久化 |
| Codex | `map-tool.ts` 定义真实 App Server 动态工具协议；新 Thread 注册，resume 走显式 compatibility fallback |
| Main | Conversation coordinator、Project Map manager、IPC 路由、Native 事件接线和启动恢复标记 |
| Preload | 暴露受限的 Map status/control/update/maintenance/state API |
| Renderer | 三列/移动 Drawer Map Panel、Conversation/Project scope、树、source jump 和维护对话只读视图 |
| Tests | Map schema/store/coordinator、逐源 cursor、context contract、Native registration 与 4 个真实 CLI smoke |

## 当前验证门槛

Gate Fix 已完成真实 CLI 验证：新 Thread Map、resumed Thread compatibility fallback、Project A/B + hidden maintenance lifecycle、独立 context tool 注册/调用/返回、pause→dirty→resume cursor-only 增量均有独立命令。所有结果保留真实 ID、revision、cursor、source 和 cleanup 分类；网络/账号限制只输出 limitation，不包装成成功。临时目录在 finally 删除，persistent smoke 按精确 ID 删除真实 Thread。

## 下一步 Gate

Phase 6 Gate 已获 GPT `PASS`。下一步只做 V1 总体验收与 Release Candidate Freeze；人工 GUI 验收完成前保持 `V1 RC / Awaiting User Manual Acceptance`，Phase 7 保持 `NOT_STARTED`。
