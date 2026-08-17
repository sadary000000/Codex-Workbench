# Phase 6：Map Runtime 能力审计

日期：2026-08-17
状态：Gate Fix 已完成，等待 GPT Gate 复审
范围：Codex CLI / App Server 0.147.0 与 Codex Workbench V1 的 Map 集成边界

## 1. 审计结论

Phase 6 采用“原生 Thread/Turn 主链 + 独立 Map sidecar”的实现边界。Map 不复制 Conversation，不改写普通回答，也不把 Map 状态塞入 `workbench-state.json`。新建 Native Thread 时可以注册动态工具；恢复已有 Thread 时，当前 App Server 的 `thread/resume` 参数没有动态工具字段，因此不宣称 resumed Thread 具备 same-turn dynamic tool，而是明确进入 `compatibility_fallback`：原 Thread 正常继续，独立 ephemeral maintenance Thread 只接收有界当前 Turn 增量并可提交 Map Patch。

本机实际 CLI 版本为 `codex-cli 0.147.0`。审计依据是该版本 CLI 的帮助和 `codex app-server generate-json-schema --experimental` 生成的协议 Schema，而不是猜测或自定义协议。

## 2. 实际协议证据

| 能力 | 实际证据 | V1 决策 |
| --- | --- | --- |
| 新 Thread 注册动态工具 | `ThreadStartParams` 有 `dynamicTools`；工具调用使用 `item/tool/call` | 在新 Thread 创建时注册 `workbench_map_patch` |
| 动态工具调用参数 | `DynamicToolCallParams` 包含 `arguments`、`callId`、`threadId`、`tool`、`turnId` | 只接受当前 Native Thread、当前 Turn 的有界 Patch |
| 动态工具返回值 | `DynamicToolCallResponse` 要求 `contentItems[]` 与 `success` | 失败只返回工具失败，不阻塞普通回答 |
| 恢复 Thread 注册动态工具 | `ThreadResumeParams` 没有 `dynamicTools`，但有 `developerInstructions` | 恢复 Thread 标记 `sameTurn=compatibility_fallback`；不伪造原生能力，必要时用独立 ephemeral maintenance Thread |
| Turn 输出 Schema | `TurnStartParams.outputSchema` 存在，语义是约束最终 assistant message | 不把它当 Map 双通道；V1 不默认启用 |
| Turn 附加上下文 | `TurnStartParams.additionalContext` 存在 | 仅 Project Map 维护 Thread 使用有界增量，不拼接完整历史 |
| Thread 开发者提示 | `ThreadStartParams.developerInstructions` 存在 | 仅用于声明 Map 工具调用边界与失败隔离 |
| 客户端维护请求 | 当前已确认的 Server Request 形状包含 `item/tool/call` | 只实现已证实的动态工具路径；未知请求 fail-closed |
| 上下文增量请求 | Codex 没有公开的原生 `context_request` method；Workbench 可在 `item/tool/call` 下注册自定义工具 | `workbench_map_context_request` 仅为 Workbench 工具，严格绑定 maintenance Thread/Project 成员和 bounded cursor，不声明为 Codex 原生协议 |

`experimentalRawEvents` 的 Schema 描述为内部用途；因此不作为产品 Map API 的稳定依据。

## 3. 与 V1 的差距和落地方式

Phase 5 donor 审计确认旧 Workbench 没有可直接迁移的 Map runtime、协议绑定或 Map UI。Phase 6 新增最小闭环：

- `src/shared/map-types.ts`：版本化 Map 文档、边界、来源锚点、Patch、校验、幂等和 revision；
- `src/shared/map-store.ts`：独立文件、原子替换、损坏文件 fail-closed、串行 mutation；
- `src/codex/map-tool.ts`：动态工具名称、Schema、返回结构和 Thread 提示；
- `src/main/map-coordinator.ts`：Conversation Map 的调用路由、失败隔离、turn 完成后的 dirty 标记，以及 resumed Thread 的 bounded compatibility fallback；
- `src/main/project-map-manager.ts`：Project Map 的独立维护 Thread、懒加载、增量更新、独立绑定、Project 成员 context request 和 resumed maintenance fallback；
- Renderer Map Panel：按需打开、Conversation/Project scope、树状节点、dirty/syncing/error/confirmation 状态、跨 Thread source jump 和只读维护对话入口；
- preload/main IPC：Map 的 status、enable、pause、resume、Project Update、维护对话读取和状态事件。

## 4. 明确不做的事情

- 不把完整 Conversation、Transcript、Prompt 或 Context 复制进 Map；
- 不偷偷把历史 Prompt 拼进新 Prompt 伪造上下文；
- 不用 `outputSchema` 强迫普通聊天返回 Map JSON；
- 不删除 Native binding、不替换 `nativeThreadId`、不吞掉原始错误；
- 不把 App Server 切为未经审查的全局生产默认；
- 不解析模型自然语言来猜测 Map，只有结构化动态工具 Patch 才能改 Map；
- 不把 Project Map 维护 Thread 混入正常 Conversation、Recent 或普通导航投影。

## 5. Gate 前验证项

代码和单元测试已覆盖 Map 文档边界、Patch 幂等/revision、来源隔离、损坏文件保护、动态工具路由和新 Thread 注册。真实 CLI 证据如下：

- `npm run test:real:map`：真实 dynamic tool 1 次、Turn completed、Map revision `0 → 1`、节点 `1 → 2`；
- `npm run test:real:resumed-map`：真实 `thread/resume` 请求无 `dynamicTools`，same-turn 为 `compatibility_fallback`，独立 ephemeral maintenance dynamic tool 1 次，Map revision `0 → 1`，cursor/sourceCursors 前进；
- `npm run test:real:project-map`：两条真实 Project Thread + 隐藏 maintenance Thread，Project Map revision `0 → 1 → 2`，重启后复用 binding 并通过 fallback 继续到 `3`，A/B 两个 source cursor 独立前进，maintenance 不在普通导航；
- `npm run test:real:context`：真实注册、调用和返回 `workbench_map_context_request`，response 保持合法 JSON；
- `npm run test:real:map-pause`：pause 中 Turn 标记 dirty，resume 后 cursor-only Patch 成功，`fullRebuildCount=0`。

所有 smoke 使用隔离临时目录；ephemeral Thread 由服务端自动清理，persistent smoke 在 finally 中按精确 Thread ID 调用 `thread/delete`，临时目录也在 finally 中删除。提交 Gate 前还需完成最终 `npm run check`、`npm test`、`npm run build`、`git diff --check`、秘密扫描和旧 donor 状态核对。

## 6. Gate Fix 复审记录

- CLI：`codex-cli 0.147.0`；`ThreadStartParams.dynamicTools` 存在，`ThreadResumeParams.dynamicTools` 不存在；`TurnStartParams.outputSchema` 未被用作 Map 通道。
- 安全边界：context request 只接受当前 hidden maintenance Thread 的 active Turn、当前 Project 成员 Thread、同 cwd、bounded `afterTurnId`、最多 2 requests / 8 turns / 12 KiB；不接受 `beforeTurnId`、任意路径、原始 transcript 或递归请求；重复 `requestId` 同 payload 幂等，不同 payload fail-closed。
- UI：右侧 Panel 的 Conversation/Project tabs、Update、dirty/syncing/error、confirmation reason、source jump、查看维护对话均已接入；maintenance Thread 不写入 `ThreadProjection`。
- 启动恢复：Main 启动路径现在识别 binding resume；Conversation Map 与 Project maintenance 都显示兼容 fallback，不显示“same-turn 可用”。
