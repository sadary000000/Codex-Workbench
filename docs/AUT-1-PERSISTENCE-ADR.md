# AUT-1 Persistence ADR

## Decision

```text
AUT-1 Persistence Engine = PROVISIONAL SINGLE-WRITER SNAPSHOT STORE
```

本阶段保留独立 JSON `automation.db`，由同一 `AutomationStore` 实例串行化 mutation，使用 draft 校验、临时文件 `fsync` 和同目录 rename 完成单快照提交。该选择只服务于 AUT-1 foundation，不代表最终 Automation persistence architecture。

## Guarantees

- 单实例 transaction 内 state、StepRuntime/Attempt 关联和 Audit append 同时成功或不落盘。
- schema、foreign reference、project boundary、canonical payload/hash、semantic hash 和 audit hash chain 在提交前校验。
- 进程重新打开时可验证 schema v2；v0/v1 迁移是显式、确定性的；未知/未来版本 fail closed。
- 不依赖 V1 Frozen Core、Native Thread/Turn/Item、WebGPT Request/Role/Project Registry 或 Browser profile。

## Deliberate non-guarantees

- 没有跨进程锁、CAS、writer epoch 或远程数据库事务。
- 没有目录 fsync、WAL、页级恢复或多文件两阶段提交。
- hash chain 是篡改检测，不是签名真实性；拥有文件写权限的进程仍可重写整份文件。
- `tx.table()` / 通用 transaction 是 foundation API；所有非状态表 mutation 的领域审计覆盖不等同于完整 WORM 日志。

## Migration triggers

必须在实现下列任一条件前单独做 persistence review，不得把当前 JSON 文件静默扩展为生产多写者数据库：

1. 第二个进程或独立 CLI 需要同时写 `automation.db`；
2. 需要跨进程协调、锁竞争、CAS 或 writer ownership；
3. 数据集增长/写放大导致整文档重写不再满足延迟或可靠性要求；
4. 需要崩溃恢复 WAL、目录 fsync、增量 backup 或跨表事务外的查询索引；
5. 需要把外部 dispatcher、Planner、Reviewer、Scheduler 或 Automation UI 接到持久化层。

## Candidate future migration

后续可评估 SQLite/WAL 或其他具备单写者/事务/迁移工具的存储，但必须保留本 ADR 的边界：Native/WebGPT 仍是各自运行事实，Automation store 不建立第二套 Conversation/Transcript truth。迁移前必须有 schema mapping、crash test、concurrent writer test、旧快照回滚策略和新的 provenance。
