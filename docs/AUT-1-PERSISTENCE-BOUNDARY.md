# AUT-1 Persistence Boundary

## 独立文件

AUT-1 使用单独的 `automation.db`。它不复用或修改：

- V1 `workbench-state.json`；
- Native App Server / Thread persistence；
- WebGPT Request Journal / Role Registry / Project Registry；
- Codex、ChatGPT 或 Browser profile。

AUT-1 源码仅依赖 Node `fs/promises`、`node:crypto` 和自身 `src/automation` 模块，未反向导入 V1 Core、Electron、Codex Runtime 或 WebGPT Runtime。

## 文件提交

```text
read current snapshot
  -> clone draft
  -> domain mutation + audit append
  -> validate schema and foreign references
  -> write same-directory temporary file
  -> fsync temporary file
  -> atomic rename to automation.db
```

回调抛错、非法状态、引用缺失、隐私键或 hash 链不合法时不会替换旧文件。Store 实例内的 Promise tail 保证单写者顺序；多进程并发写入、锁服务、远程数据库和跨文件事务明确不属于 AUT-1。

## 隐私边界

Metadata 只允许 bounded scalar values，并拒绝 prompt/response/transcript/cookie/token/authorization/password/credential/secret/stdout/stderr/raw body 等敏感键。Requirement 正文只能通过 opaque `contentRef` 表示，adapter 只接受/返回受限 ref/hash。

## 迁移

当前仅提供显式 v0 -> v1 迁移和未来版本拒绝。迁移结果在下一次成功 transaction 时以同样的原子提交方式写回；不会自动导入 V1 或 WebGPT 数据。

## 风险和后续审查

JSON 文件适合本地、有限规模、单写者 foundation，不宣称多进程 ACID。若未来允许多进程/独立 CLI writer，必须增加 lock/CAS/writer epoch，并重新做迁移与崩溃恢复审查。
