# ARCH-V2-7 Implementation Reality

> 生成阶段：ARCH-V2-7 开工前 Reality Audit。依据 `35db6d4ea15b72d115bc2b96ac4bc95c477388a9` 及当前工作树真实源码；不把本报告中的缺口自动解释为下一轮产品方向。

## Scope and safety

- 工作仓库：`D:\办公\AI\Codex_Workbench_V1`
- 基线：`35db6d4 docs: finalize arch-v2-6 fix round 1 review`
- 旧 donor 与 V1 Frozen Core：只读、不修改。
- `AUT-2/AUT-3`：仍为 `PAUSED_NOT_EXECUTABLE`。
- `real_business_prompts = 0`；本阶段不创建真实业务 Chat。

## Current canonical stores

| Domain / entity | Current store | Current writer | Reality |
|---|---|---|---|
| Native Thread / Turn / Item | Codex App Server / Native Runtime | Codex runtime | Workbench 只保存 Thread projection/binding，不重建 Native transcript truth。 |
| V1 Project / Thread projection / Composer preference / PromptRecovery | `V1PersistenceStore` → `workbench-state.json` | `src/shared/persistence-store.ts` 及 Main IPC orchestration | JSON 使用临时文件写入后 rename；projection 是 UI/recovery 派生数据。 |
| Automation domain entities | `AutomationStore` → SQLite `automation/automation.db` | `src/automation/store.ts` transaction boundary | `SqliteAutomationPersistence.replaceDocument()` 在 `BEGIN IMMEDIATE` 下批量 upsert/delete。 |
| WebGPT provider-local Request Journal | `WebGptRequestManager` → `<userData>/webgpt/requests/requests.json` 与 `results/` | `src/features/webgpt/runtime/webgpt-request-manager.ts` | 只保存 provider-local request/result facts，不是 Workflow truth。 |
| WebGPT Project / Role registries | `<userData>/webgpt/projects/*`、`<userData>/webgpt/roles/*` | 对应 provider-local registry | 不得提升为 Automation canonical truth。 |
| WebGPT browser/session data | `<userData>/webgpt/session` | WebGPT runtime/session | 本阶段不复制、不打包、不读取 cookie/token/profile。 |

## Reality questions

### Q1–Q5 — stores, formats and projections

1. **Canonical stores**：Native Runtime、V1 JSON projection store、Automation SQLite store、WebGPT provider-local registries/journal，各自边界如上；目前没有一个统一跨域 store。
2. **SQLite entities**：`AutomationDocument` 的全部 Automation tables，包括 `automationProjects`、Requirement/Plan/Stage/Step、`executionAttempts`、`actionIntents`、`actionAttempts`、`actionReceipts`、`externalRefs`、`evidences`、`artifactRefs`、`resourceClaims`、`workspaceSnapshots`、`policyVersions` 等。
3. **JSON/file entities**：V1 `projects/threads/prompts/composerPreferences`；WebGPT `requests.json`、结果文件、Project Registry、Role Registry；Native binding/log/diagnostics 另有文件边界。
4. **Request Journal facts**：requestId、idempotencyKey、provider-local state、project/role/target metadata、policyVersionId（新记录）、时间/错误/结果摘要与受控 result path；RequestManager 明确禁止以 Journal 代替 Workflow truth。
5. **Projection locations**：V1 `workbench-state.json` 的 Thread/Project/Composer/PromptRecovery projection；UI projection 在运行时由 Native events/read model 派生。当前没有一个统一的 `rebuildAllProjections()` production service。

### Q6–Q10 — schema, version, implicit writes and migration safety

6. **Schema/version**：Automation document version 为 `AUTOMATION_SCHEMA_VERSION = 3`；SQLite persistence format 为 `sqlite-record-v1`、persistence schema version 为 `1`，均写入 `automation_meta`。WebGPT Request Journal 当前读 v1/v2 并持久化写 v2；V1 JSON state 自身为 version 1。
7. **Implicit writes**：`AutomationStore` 的 `transaction()` 是显式 command 写边界；`V1PersistenceStore` 的 create/update/begin/update prompt 是 mutation。Automation SQLite 构造函数会建表/写 metadata，属于 store 初始化副作用；这需要在 ARCH-V2-7 中隔离为 explicit migration/open boundary。WebGPT RequestManager 的 load 路径对 Journal schema migration 会写回 v2，属于 provider-local migration，不得混入 Workflow query。
8. **Implicit reconcile**：Automation Store 的 snapshot/inspect/纯 `get()` 不调用 WebGPT reconcile；WebGPT `requestStatus(requestId, reconcile=true)` 会在 recovery state 下显式转到 `reconcileRequest()`，而默认 query path 是纯读。需继续机器化证明 query/status/inspect 不产生 reconcile/write。
9. **Migration helpers/commands**：`AutomationStore.migrate()`、`migrateJsonSnapshotToSqlite()`、`recoverInterruptedMigration()`、`migrateAutomationDocument()` 存在；当前没有面向用户/CLI 的独立 migration command 和统一 migration report contract。
10. **Safe-fail reality**：JSON→SQLite 使用临时 SQLite、候选验证、备份 rename 和 recovery marker；SQLite document replacement 有 transaction。现有代码仍需 fault-injection 证明 rename/backup 中断和 schema migration 中断不会造成语义半迁移；不能仅凭实现声称已覆盖。

### Q11–Q17 — crash/restart, policy and PromptRecovery

11. **Crash/restart Action state**：Automation `ActionIntent/ActionAttempt/ActionReceipt` 状态和 provider correlation 已进入 SQLite；WebGPT RequestManager restart 会装载 Journal 并把未完成 provider-local request 分入 recovery/reconcile 路径。当前缺少统一跨 store Recovery Intent contract/单一 classifier。
12. **Provider accepted + local persist failure**：ARCH-V2-4/6 已有 `UNKNOWN` / `RECOVERY_REQUIRED` 与 no-blind-resend 保护；仍需要 ARCH-V2-7 在 isolated fixture 中证明 `ActionAttempt`、ProviderRequestRef、Receipt 的恢复序列，不创建第二 Attempt。
13. **UNKNOWN ProviderRequest**：现有 `WebGptExternalActionBridge.reattachExisting()` / `reconcile()` 使用既有 ProviderRequest correlation；应由 recovery gate 验证，不得在新路径复制一套 classifier。
14. **ResourceClaim vs live lease**：Automation `ResourceClaim` 持久化 `resourceLeaseRef/leaseEpoch/state`；WebGPT `OperationArbiter` 是运行时 live lease。当前类型和代码已有两个边界，但需要独立 recovery test 明确历史 `ACQUIRED` claim 在无 live lease 时不等于当前 BUSY。
15. **Policy pin**：新 ActionIntent/ActionAttempt/Checkpoint 与 WebGPT Request metadata 可携带 `policyVersionId`；`PolicyVersion` immutable，Authority 做 pin/decision。需补跨 restart test，禁止用 latest policy 替换已 pin 的 Attempt；legacy missing pin 要 read-compatible、执行 fail-closed。
16. **Legacy unpinned**：schema 允许若干旧记录缺少 `policyVersionId`，现有 compatibility 读取存在；执行侧已有 policy precondition/fail-closed 语义，但尚未形成统一 `POLICY_PIN_REQUIRED` recovery contract 的完整 migration evidence。
17. **PromptRecovery**：V1 `workbench-state.json` 的 `prompts` 当前保存 bounded full prompt string、localRunId/nativeThreadId/status/turn/error；WebGPT Journal 以 prompt hash/char count 和 provider-local metadata 为主，但部分 RequestManager 内存/Journal flow 仍接受 prompt。新 Recovery Intent 不应把 full raw prompt 作为 canonical recovery truth；历史数据必须保持 read-compatible，review package 不得携带 raw prompt。

### Q18–Q22 — rebuild, composition and harness

18. **Projection rebuildability**：Native message/UI projection 可由 Native events/read；V1 persisted Thread projection 有 identity/cwd/title/state/error，但当前没有完整 production rebuild command；需选择一个 isolated projection 做 delete/rebuild semantic-equivalence gate。Automation canonical tables本身不是 projection。
19. **Composition root**：生产装配主要在 `src/main/main.ts`：`AutomationStore`、`ensureWebGptRuntimePolicy()`、`getWebGptProviderPort()`、`WebGptRequestManager`、registries/runtime 等从 userData 装配；`src/features/webgpt/automation/webgpt-provider-port.ts` 是 provider adapter boundary。需要最小隔离 wiring，不进行 main.ts 全面重构。
20. **Concrete `new` risk**：Main 是主要 concrete assembly；Automation domain/service 多数通过构造函数注入 store/provider。ARCH-V2-7 challenge 必须继续扫描 domain/service/store 内部自行 `new` runtime/store 的情况，尤其 test/harness 与 legacy compatibility seams。
21. **Review/smoke harness**：现有 tests/scripts 使用 fake App Server、isolated temp directories、provider fixtures 和 real smoke entry points；当前未有一个统一 ARCH-V2-7 Review Harness composition root。新 harness 必须复用 production service，替换 filesystem/provider transport/clock，而不是复制业务逻辑。
22. **Legacy schema compatibility**：Automation v0/v1 migration helper 会填充/转换历史结构，SQLite v2→v3 metadata migration 也存在；这类 legacy records 应先通过 inspect 返回 migration/compatibility 状态，缺执行关键事实的记录不得自动套 latest defaults 变为 executable。Request Journal v1/v2 的 provider-local compatibility 也应保持隔离。

## Initial gaps to prove or fix within ARCH-V2-7

1. 把 migration/read compatibility/status 与 write migration 的 contract 机器化；读路径必须 state/hash 前后不变。
2. 形成单一 Recovery Intent/Classifier 组合层，复用现有 WebGPT readiness/reconcile，不复制第二套 recovery truth。
3. 选择 V1 Thread projection 或一个 Automation-derived view 做 isolated delete/rebuild，不触碰 Native truth。
4. 建立 production-equivalent harness composition，注入 isolated roots 和 provider fixture，禁止真实 business Prompt。
5. 将 legacy missing policy pin、historical ResourceClaim、UNKNOWN provider outcome、terminal receipt 作为明确 fail-closed tests。

## Not claimed

- 本文不是 Gate PASS；它是开工前现实审计。
- 未声称跨 provider exactly-once。
- 未声称 V1 `PromptRecovery` 已经移除 full prompt 保存。
- 未声称所有 projection 已有生产 rebuild command。
- 未修改 V1 Frozen Core、旧 donor、AUT-2/AUT-3 或生产 Journal。

## Post-implementation reality update

本阶段已补齐并验证的最小边界：

- `WebGptRequestManager.load()` 对 v1 Journal 只做内存兼容读取；`migrate()` 才写入 v2。
- `WebGptProjectRegistry`、`WebGptRoleSessionRegistry` 和 Request query 在缺失目录上不创建目录；Role mutation 在 persist 失败时回滚内存绑定。
- `AutomationMigrationService` 提供 `READ_COMPATIBLE`、`MIGRATION_REQUIRED`、`MIGRATED`、`UNSUPPORTED`、`CORRUPT` 五态检查/迁移边界，并校验 ID 与 correlation 字段。
- Automation 生产装配已通过 `createProductionAutomationComposition()` 进入；Review Harness 使用独立 root，重叠生产 root 时拒绝启动，不创建目录。
- `PromptRecovery` 磁盘事实改为 `promptSha256`、`promptLength` 和 `promptRef`；raw Prompt 仅在当前进程内为兼容返回值，重启后不可从 V1 持久化文件恢复原文。
- SQLite interrupted migration 在提升 JSON backup 前重新解析/校验；无效 backup 保留并 fail-closed。
- Projection delete/rebuild、provider accepted + local persistence fault、UNKNOWN reattach、policy pin、ResourceClaim/live lease 已由隔离 Harness 覆盖。

因此本文件前半部分保留为开工前事实快照；本节是实现后的真实状态，不把未实现的完整跨域 rebuild service 或 exactly-once 语义宣称为已完成。
