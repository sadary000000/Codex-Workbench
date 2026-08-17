# Phase 6：Map 技术设计

日期：2026-08-17
状态：Gate Fix 已实现，等待 GPT Gate 复审

## 1. 总体结构

```text
Native Thread / Turn / Item
          │
          ├── 普通回答与原生 Workspace
          │
          └── item/tool/call(workbench_map_patch)
                    │
                    ├── ConversationMapCoordinator
                    │       └── conversation MapStore
                    │
                    └── ProjectMapManager
                            ├── project MapStore
                            └── 独立维护 Native Thread / binding
```

Map 是 sidecar：它引用 Native `threadId`、`turnId`、`itemId`，但不拥有或替代这些身份。普通聊天的回答仍由 Native Workspace 展示，Map 调用失败只能让 Map 进入 error/dirty 状态，不能让正常回答消失。

## 2. 数据模型

Map 文档包含 `schemaVersion`、`mapId`、`scope`、`revision`、`rootNodeId`、`nodes`、`sync`、`promptVersion` 和有界 `recentPatches`。范围只有：

- Conversation：绑定一个 `nativeThreadId`；
- Project：绑定一个 `projectId`，来源可来自多个 Native Thread。

节点拥有稳定 `nodeId`、父子关系、标题、状态、详情、历史、来源和 ordering。非根节点必须有来源锚点；来源必须属于当前 scope。每次 Patch 都有 `patchId`、digest、baseRevision、sourceCursor、操作列表和是否需要用户确认。

校验在落盘前对候选文档整体执行：限制数量和字符串大小，拒绝非法 ID、重复 ID、跨 scope 来源、缺父节点、环、隐式删除子树、重复 Patch、旧 revision 和 digest 不匹配。校验失败保留旧文档。

## 3. 持久化与同步

MapStore 使用独立目录和按 scope 编码的文件名，不写入 Workbench 普通状态文件。写入采用临时文件加 rename，读到损坏或未知版本时 fail-closed。mutation 通过队列串行化，Patch 幂等由 `patchId`/digest/ledger 保证。

Conversation Map 生命周期为 enable → initializing/active → dirty/synced/error；pause/resume 是显式控制。turn 完成时若没有成功 Patch，只标记 dirty，不补造 Map 内容。恢复已有 Native Thread 时记录 `sameTurn=compatibility_fallback`：原 Thread 不伪造 dynamic tool，只有独立 ephemeral maintenance Thread 可在有界 delta 上提交 Patch。

Project Map 不复用普通 Conversation projection 或导航；它懒加载独立 runtime 和 binding，维护时只发送有界的当前增量与节点摘要，不发送完整历史。Project 来源成员关系持久化在 Map 自己的 sidecar 中。恢复 maintenance binding 后若 dynamic tool 不能由 `thread/resume` 重注册，更新自动转入同样的 ephemeral compatibility fallback，维护 ID 和 Map cursor 仍保持可追踪。

## 4. UI 与安全边界

Map Panel 默认隐藏，打开后显示 Conversation/Project scope、状态、enable/pause/resume、Project Update、树节点和状态标记。来源节点携带 Native turn/item 锚点，可跨 Thread 跳回现有 Workspace 内容；维护对话仅提供只读查看入口。Panel 不创建第二套 Transcript，也不改变 Composer、Stop、Approval 或 Native 导航语义。

动态工具只接受明确的 Patch schema；未知 server request 和非法 Patch fail-closed。工具失败返回 `success=false` 的结构化响应并记录错误，不吞掉原始错误。Patch 中 `requiresUserConfirmation` 为真时拒绝自动应用，保留文档不变。

## 5. 后续限制

当前实现不承诺恢复 Thread 的原生 same-turn 动态工具；兼容 fallback 只传有界当前增量。`workbench_map_context_request` 是 Workbench 自定义 dynamic tool，不是 Codex 隐藏协议；它只允许 bounded `afterTurnId`、成员 Thread 和安全投影。系统不执行完整历史压缩、不做关键词/自然语言解析，也不把 Project Map 的后台维护扩展成普通聊天功能。只有真实使用和 Gate 审查证明缺口后，才讨论下一阶段增强。
