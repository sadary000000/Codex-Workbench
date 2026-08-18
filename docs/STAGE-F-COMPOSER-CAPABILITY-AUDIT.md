# STAGE F — Composer Capability / Approval 能力审计

日期：2026-08-18  
项目：Codex Workbench V1  
Codex CLI：`codex-cli 0.147.0`

## 审计结论

本阶段只接入 App Server 已确认的下一 Turn request 能力：模型、模型支持的 reasoning effort、approval policy、sandbox policy。Thread、Turn、Item 和审批请求仍由 Native App Server 与现有 broker 负责；Composer 偏好只存在于 Renderer 的 `nativeThreadId` 分桶中，不成为新的产品事实源。

附件不在本阶段做文件选择器。App Server schema 支持 image/localImage 等 input variant，但当前 Workbench 没有安全、可复现的本地文件选择与路径授权流程，因此标记为 `SCHEMA_ONLY / DEFERRED`。

## 证据来源

- `codex --version`：`codex-cli 0.147.0`
- `codex app-server --help`
- `codex app-server generate-json-schema --experimental`
- 真实 `codex.exe app-server --stdio` JSON-RPC 探针：`initialize`、`model/list`、`config/read`、`permissionProfile/list`、`thread/start`、`thread/resume`、`thread/read`、`turn/start`、`thread/settings/update`
- `scripts/real-composer-capability-smoke.ts`
- 真实 smoke 输出：`STAGE_F_COMPOSER_CAPABILITY`，同一 `nativeThreadId` 下完成 `model + effort + approvalPolicy + sandboxPolicy` 的 Turn

## 能力矩阵

| 能力 | 结论 | 证据/当前边界 |
| --- | --- | --- |
| `initialize` | `RUNTIME_VERIFIED` | 真实返回 Codex CLI 版本、codexHome、Windows 平台信息 |
| `thread/start` | `RUNTIME_VERIFIED` | 真实新建 Thread；现有路径默认 `approvalPolicy=never`、`sandbox=read-only` |
| `thread/resume` / `thread/read` | `RUNTIME_VERIFIED` | 真实恢复既有 Thread 并读取 Native turns |
| `turn/start` 文本 | `RUNTIME_VERIFIED` | 现有 Native Turn 链路与真实 smoke 均完成 |
| `model/list` | `RUNTIME_VERIFIED` | 真实返回 6 个模型、默认模型、输入模态与 per-model reasoning efforts |
| Model 选择 | `RUNTIME_VERIFIED` | Renderer 动态来自 `model/list`，不硬编码模型名 |
| Reasoning effort | `RUNTIME_VERIFIED` | per-model effort 映射到 `turn/start.effort`；真实 smoke 使用默认模型的 medium effort |
| Approval policy | `RUNTIME_VERIFIED` | `never` / `on-request` 映射到 `turn/start.approvalPolicy`；现有 Native broker 继续处理 server request |
| Sandbox | `RUNTIME_VERIFIED` | `read-only` / `workspace-write` 映射到 v2 `sandboxPolicy`；workspace-write 仅允许当前 cwd |
| Permission profiles | `RUNTIME_VERIFIED / UI DEFERRED` | 真实 `permissionProfile/list` 可读；本阶段没有必要的产品选择语义，不在 Composer 暴露 |
| Interactive Approval | `BROKER_READY / MANUAL_REQUIRED` | 现有按 `(nativeThreadId, rpcId type+value)` 隔离、超时/关闭 fail-closed；本次自动 smoke 使用 never/read-only，未声称真实审批已触发 |
| Image input | `RUNTIME_VERIFIED / UI DEFERRED` | schema 与真实探针支持 `{type:"image",url}`；本阶段不增加附件选择器 |
| local image/audio/skill/mention | `SCHEMA_ONLY / DEFERRED` | 没有安全 picker、权限和产品需求闭环 |
| generic attachment | `UNSUPPORTED` | 不属于当前 input variant |
| `config/value` | `UNSUPPORTED` | 实际返回 unknown variant；不作为 Composer 能力来源 |

## 关键映射

```text
Renderer per-thread preference
  → preload native-runtime:turn
  → Main 校验 requested == selected == runtime 且 Runtime=READY
  → NativeThreadRuntime.startTurn
  → turn/start { threadId, input, model?, effort?, approvalPolicy?, sandboxPolicy? }
  → Native Turn / Native Item / native approval event
```

所有 preference 都是“下一条 Turn 的请求参数”，不写入 ThreadProjection，不替代 Native settings，也不创建 Conversation/Transcript 第二事实源。

## 未完成能力

- 真实 GUI Approval Allow/Deny、A/B 同号 RPC 隔离、超时与关闭收束需要人工验收；自动化只覆盖已有 broker contract 与非审批真实 smoke。
- 附件 UI 延后；不把 schema 存在误报为产品支持。
