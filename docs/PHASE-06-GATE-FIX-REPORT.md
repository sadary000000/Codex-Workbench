# Phase 6 Gate Fix 阶段报告

状态：GPT Gate PASS；Phase 6 已冻结，进入 V1 总体验收与 RC Freeze

## 1. 阶段结论

本阶段针对 GPT 对 Phase 6 的 FIX 意见完成了最小闭环：保留原有 Conversation Map 主链和 42 个既有测试，在不伪造 resumed Thread 原生能力的前提下，补齐恢复会话的有界兼容路径、Project Map 生命周期、受限上下文请求、暂停/脏状态恢复，以及对应的 UI 入口与状态反馈。

实现边界仍然是 Native Thread/Turn 主链 + Map sidecar。Map 不复制完整 Conversation、不拼接历史 Prompt、不把隐藏维护 Thread 当作普通导航会话，也不把不确定结果包装为成功。

## 2. 协议与能力证据

实际 CLI 版本：`codex-cli 0.147.0`。

通过 `codex app-server --help` 和 `generate-json-schema --experimental` 核对到：

- `ThreadStartParams` 支持 `dynamicTools` 和 `developerInstructions`；
- `ThreadResumeParams` 没有 `dynamicTools`，但支持 `developerInstructions`；
- `TurnStartParams.outputSchema` 只约束最终 assistant message，不作为 Map 工具注册方案。

因此新 Thread 使用原生 dynamic tool；resumed Thread 明确标记 `sameTurn=compatibility_fallback`，原 Thread 继续执行，独立 ephemeral maintenance Thread 只处理有界的当前 Turn 增量。该路径不扫描完整历史、不生成完整 Map、不伪造历史事件。

## 3. Gate Fix 实现

- resumed Conversation Map：恢复同一 Native Thread 后完成另一轮 Turn，使用独立兼容维护 Thread 提交当前增量 Patch，revision/cursor/sourceCursor 前进。
- Project Map：支持项目成员 A/B、启用/暂停/脏/同步/错误状态、hidden maintenance Thread、重启恢复、每源 cursor、维护对话只读查看；维护 Thread 不进入普通导航列表。
- 上下文请求：新增 `workbench_map_context_request`，仅允许当前项目成员 Thread、有限 cursor/range、有限请求数/Turn 数/字节数，并做 requestId 幂等、成员/CWD、来源身份与回环校验；不允许任意路径或任意 IPC。
- UI：增加 Conversation/Project Map 入口、树状内容、dirty/sync/error/confirmation 状态、Update、来源跳转和“查看维护对话”；确认要求明确显示“需要通过正常对话确认”。
- Pause/resume：暂停期间只记录 dirty，恢复只做 cursor-only 增量，`full_rebuild_count=0`。

## 4. 真实 CLI 证据

以下为最近一次通过结果；真实 ID 仅作为可追溯证据，临时 Thread 在脚本 `finally` 中按精确 ID 清理。

| 命令 | 结果摘要 |
|---|---|
| `npm run test:real:map` | PASS；新 Thread，工具调用 1 次，revision `0→1`，节点 2，临时资源自动清理 |
| `npm run test:real:resumed-map` | PASS；resume 请求无 `dynamicTools`，`compatibility_fallback`，维护工具调用 1 次，revision `0→1`，cursor/source 前进，原 Thread 精确删除 |
| `npm run test:real:project-map` | PASS；A/B 两个源 + hidden maintenance，重启前后 revision `2→3`，context request 1 次，维护 Thread 排除普通导航，三条真实 Thread 均精确删除 |
| `npm run test:real:context` | PASS；真实 dynamic tool 注册、调用、返回，响应 340 bytes，临时资源自动清理 |
| `npm run test:real:map-pause` | PASS；暂停时 dirty，恢复后 cursor-only 增量，revision `1`，`full_rebuild_count=0`，临时资源自动清理 |

## 5. 机器验证

- `npm test`：45/45 PASS；
- `npm run check`：PASS；
- `npm run build`：PASS；
- `npm audit --omit=dev`：PASS，0 vulnerabilities；
- `git diff --check`：PASS；高风险凭据模式扫描：无命中；旧 donor 工作树仅保留既有基线改动。

## 6. 并行审计结果

四个互不冲突的审计子代理均已自然完成并关闭，当前不保留运行中的子代理：

| 子代理 | 结论 |
|---|---|
| `01a01028-e1a6-7b90-8f4a-8e5417448b29` Heisenberg | CLI schema/protocol；确认 resume 无 dynamicTools，建议独立有界 fallback |
| `01a01028-e273-7ef2-80cd-5abcd072fb56` Pasteur | Project Map 生命周期与真实 smoke 审计 |
| `01a01028-e34c-7950-9dbe-78aa1f6c961e` McClintock | context tool 的注册、边界与安全约束审计 |
| `01a01028-e414-7eb2-8da7-3b83a0f242cc` Kierkegaard | Project Map UI、维护视图、来源跳转与确认态审计 |

## 7. 已知限制与复审请求

当前 CLI 协议仍未提供 resumed Thread 的原生 `dynamicTools` 字段，因此不能宣称恢复会话拥有原生 same-turn Map tool；兼容路径是有界、短生命周期、仅当前增量的维护 Thread。`workbench_map_context_request` 是 Workbench 自定义受限工具，不改变 Codex 原生协议。

本阶段未进行人工 GUI 测试，原因是当前阶段验收约定为纯命令行测试；UI 已通过 TypeScript/build 检查，真实生命周期由 CLI smoke 覆盖。

旧只读 donor `D:\办公\AI\Codex_Workbench` 不在本阶段修改范围内。

[CODEX_WORKBENCH_STAGE_REVIEW]
stage: Phase 6 Gate Fix
status: GPT Gate PASS; Phase 6 frozen
request: PASS
implementation_commit: `5c1fed7` (`fix: close phase 6 map gate gaps`)
next_stage: V1 total acceptance and Release Candidate Freeze; Phase 7 remains NOT_STARTED
