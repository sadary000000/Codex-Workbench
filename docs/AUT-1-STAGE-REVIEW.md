# AUT-1 Stage Review

## Stage

```yaml
stage: AUT-1 Domain Store + State Machine Foundation
mode: PROVISIONAL_FOUNDATION
aut0_status: NOT_FROZEN
result: PASS_CANDIDATE
```

AUT-1 只落地中立基础设施，不代表 AUT-0 已冻结，也不开始 AUT-2/Automation 产品层。真实 Native/WebGPT execution 在本阶段明确为 `NO`。

## Scope resolution

### In scope

- 独立版本化 `automation.db` 文档和 v0 -> v1 migration；
- Requirement/Plan/Stage/Step 版本 identity 与 `supersedes`；
- Project/Step/Attempt/ActionIntent/ActionAttempt 状态机原语；
- append-only AuditEvent sequence/hash 链和 state+audit 同事务提交；
- ActionIntent / idempotency / ActionAttempt / Receipt / UNKNOWN recovery 原语；
- Checkpoint、ExternalRef、Evidence、ArtifactRef、ResourceClaim、WorkspaceSnapshot、PolicyVersion；
- Native/WebGPT adapter interface contract（仅 opaque refs）；
- contract/unit/boundary tests 和文档/审查包。

### Out of scope

Planner、Reviewer、Requirement GPT、Verifier、Scheduler、Workflow Engine、Automation UI、真实 dispatcher、Native/WebGPT 调用、浏览器操作、V1 Frozen Core 变更、Prompt/Transcript/Cookie/Token 复制。

## Architecture boundary

```text
V1 Frozen Core (unchanged)
        |
        +-- AUT-1 neutral foundation
              +-- independent automation.db
              +-- domain schema/migrations
              +-- state + audit transaction
              +-- intent/attempt/receipt/checkpoint primitives
              +-- opaque Native/WebGPT adapter contracts
```

AUT-1 不成为第二套 Conversation/Transcript truth。Native Thread/Turn/Item 和 WebGPT Request 仍属于各自运行时；Automation 只保存外部 identity/status/hash/ref。

## Implementation files

- `src/automation/types.ts`
- `src/automation/schema.ts`
- `src/automation/state-machine.ts`
- `src/automation/store.ts`
- `src/automation/adapters.ts`
- `src/automation/index.ts`
- `tests/automation-foundation.test.ts`

## Key implementation evidence

1. `AutomationStore.transaction()` 使用串行写队列、draft、schema/reference validation、temp+fsync+rename。
2. `automationSchemaVersion` 为 1；明确 v0 fixture 可迁移，新版本 fail closed。
3. 版本实体保留旧 identity，Attempt 绑定具体 `stepSpecId`。
4. `appendAudit()` 产生连续 sequence、prevHash/hash；AuditEvent 不允许通过通用 insert/replace 修改。
5. Intent 必须先存在且为 `DISPATCH_ELIGIBLE`，才可产生 ActionAttempt；当前没有外部 dispatcher。
6. UNKNOWN receipt 进入 `UNCERTAIN` / `RECOVERY_REQUIRED`，没有盲目重试。
7. Adapter 仅使用 bounded opaque refs，不导入 V1/WebGPT runtime。

## Verification

| Gate | Result |
| --- | --- |
| independent automation.db / migration / reopen | PASS |
| immutable versioning / exact StepSpec binding | PASS |
| valid/invalid transitions and atomic rollback | PASS |
| append-only audit/hash chain | PASS |
| intent/idempotency/unknown receipt | PASS |
| checkpoint/resource/workspace primitives | PASS |
| adapter boundary | PASS |
| `npm run check` | PASS |
| `npm test` | 224/224 PASS |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS, 0 vulnerabilities |
| secret scan / `git diff --check` | PASS |

## Boundary and privacy evidence

AUT-1 专项测试确认：

- 独立文件不包含 V1/WebGPT transcript data；
- sensitive metadata key 被拒绝；
- orphan ActionAttempt、错误 acquired claim、audit tamper 会 fail closed；
- transaction callback failure 不会落盘部分 audit/state；
- 适配器只提供类型契约，不执行外部调用。

## Known limitations

- JSON 文件是单进程单写者 foundation，不宣称跨进程 ACID；
- ResourceClaim 当前是可持久化声明和一致性校验，不是容量仲裁/租约服务；
- Checkpoint 是引用快照，不是完整 reconcile service；
- Action Receipt 的真实采集、验证和外部状态 reconcile 留待后续阶段；
- 尚未接入 main/IPC/CLI/Automation UI；
- AUT-0 仍为 `NOT_FROZEN`。

## Subagents

4 个只读审计子代理分别检查 schema/storage、state/audit、intent/recovery、resource/workspace/adapters。它们没有修改共享文件；结果已由主 Agent 审核并反映在实现和测试中。Gate 前必须关闭全部已完成代理，`running_subagents=0`。

## Provenance

```text
base_commit: 36938f0
implementation_commit: 39fa88bf017d11d0644d8daffe479baf88e1f9f1
review_commit: documentation/package commit recorded in final handoff
v1_core_changed: NO
webgpt_v1_changed: NO
real_native_execution_started: NO
real_webgpt_execution_started: NO
```

## Verification timestamp

`2026-08-21T19:57:34+08:00` (local)

## Gate

```text
PASS_CANDIDATE; review package generated and ready for user/GPT review
```
