# Phase 6：Map Runtime 能力审计

日期：2026-08-17
状态：已完成，等待 GPT Gate 审查
范围：Codex CLI / App Server 0.147.0 与 Codex Workbench V1 的 Map 集成边界

## 1. 审计结论

Phase 6 采用“原生 Thread/Turn 主链 + 独立 Map sidecar”的实现边界。Map 不复制 Conversation，不改写普通回答，也不把 Map 状态塞入 `workbench-state.json`。新建 Native Thread 时可以注册动态工具；恢复已有 Thread 时，当前 App Server 的 `thread/resume` 参数没有动态工具字段，因此恢复 Thread 暂标记为不可用 same-turn Map，不能伪造能力。

本机实际 CLI 版本为 `codex-cli 0.147.0`。审计依据是该版本 CLI 的帮助和 `codex app-server generate-json-schema --experimental` 生成的协议 Schema，而不是猜测或自定义协议。

## 2. 实际协议证据

| 能力 | 实际证据 | V1 决策 |
| --- | --- | --- |
| 新 Thread 注册动态工具 | `ThreadStartParams` 有 `dynamicTools`；工具调用使用 `item/tool/call` | 在新 Thread 创建时注册 `workbench_map_patch` |
| 动态工具调用参数 | `DynamicToolCallParams` 包含 `arguments`、`callId`、`threadId`、`tool`、`turnId` | 只接受当前 Native Thread、当前 Turn 的有界 Patch |
| 动态工具返回值 | `DynamicToolCallResponse` 要求 `contentItems[]` 与 `success` | 失败只返回工具失败，不阻塞普通回答 |
| 恢复 Thread 注册动态工具 | `ThreadResumeParams` 没有 `dynamicTools` | 恢复 Thread 标记 `sameTurn=false`，不宣称支持 |
| Turn 输出 Schema | `TurnStartParams.outputSchema` 存在，语义是约束最终 assistant message | 不把它当 Map 双通道；V1 不默认启用 |
| Turn 附加上下文 | `TurnStartParams.additionalContext` 存在 | 仅 Project Map 维护 Thread 使用有界增量，不拼接完整历史 |
| Thread 开发者提示 | `ThreadStartParams.developerInstructions` 存在 | 仅用于声明 Map 工具调用边界与失败隔离 |
| 客户端维护请求 | 当前已确认的 Server Request 形状包含 `item/tool/call` | 只实现已证实的动态工具路径；未知请求 fail-closed |
| 隐藏上下文维护 | 当前 Schema/帮助未提供可直接依赖的 `context_request` 产品路径 | 不自行发明或绑定隐藏协议 |

`experimentalRawEvents` 的 Schema 描述为内部用途；因此不作为产品 Map API 的稳定依据。

## 3. 与 V1 的差距和落地方式

Phase 5 donor 审计确认旧 Workbench 没有可直接迁移的 Map runtime、协议绑定或 Map UI。Phase 6 新增最小闭环：

- `src/shared/map-types.ts`：版本化 Map 文档、边界、来源锚点、Patch、校验、幂等和 revision；
- `src/shared/map-store.ts`：独立文件、原子替换、损坏文件 fail-closed、串行 mutation；
- `src/codex/map-tool.ts`：动态工具名称、Schema、返回结构和 Thread 提示；
- `src/main/map-coordinator.ts`：Conversation Map 的调用路由、失败隔离、turn 完成后的 dirty 标记；
- `src/main/project-map-manager.ts`：Project Map 的独立维护 Thread、懒加载、增量更新和独立绑定；
- Renderer Map Panel：按需打开、树状节点、冻结状态标记、Native source jump；
- preload/main IPC：Map 的 status、enable、pause、resume 和增量更新。

## 4. 明确不做的事情

- 不把完整 Conversation、Transcript、Prompt 或 Context 复制进 Map；
- 不偷偷把历史 Prompt 拼进新 Prompt 伪造上下文；
- 不用 `outputSchema` 强迫普通聊天返回 Map JSON；
- 不删除 Native binding、不替换 `nativeThreadId`、不吞掉原始错误；
- 不把 App Server 切为未经审查的全局生产默认；
- 不解析模型自然语言来猜测 Map，只有结构化动态工具 Patch 才能改 Map；
- 不把 Project Map 维护 Thread 混入正常 Conversation、Recent 或普通导航投影。

## 5. Gate 前验证项

代码和单元测试已覆盖 Map 文档边界、Patch 幂等/revision、来源隔离、损坏文件保护、动态工具路由和新 Thread 注册。真实 CLI Map smoke 已完成：dynamic tool 真实调用 1 次、Turn completed、Map revision `0 → 1`、节点 `1 → 2`；CLI 还明确要求 initialize 的 `experimentalApi=true`。smoke 使用 `ephemeral=true`，该类 Thread 不支持 `thread/delete`，由服务端自动不持久化，测试临时目录也在 finally 中删除。提交 Gate 前还需完成最终 `npm run check`、`npm test`、`npm run build`、`git diff --check`、秘密扫描和旧 donor 状态核对。
