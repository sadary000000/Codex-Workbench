# AUT-1 Persistence Boundary

## 独立文件

AUT-1 使用单独的 `automation.db`，schema v2。它不复用或修改：

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

回调抛错、非法状态、引用缺失、隐私键、canonical payload/hash 或 audit 链不合法时不会替换旧文件。Store 实例内的 Promise tail 保证单写者顺序；这不是跨进程锁。

## Requirement 真值和隐私

RequirementVersion 自身保存 bounded `canonicalPayload` 与 `payloadSha256`，因此外部 `contentRef` 不是唯一真值。canonical payload 只接受稳定 JSON object，最大 32 KiB、深度 8、节点 256、对象键 64、叶字符串 8 KiB；敏感键拒绝。它不允许保存 Prompt、Transcript、Response、Cookie、Token、Authorization、Password、Private Key、raw body、DOM 或 HTML。SHA 提供完整性校验，不提供签名真实性。

## 迁移

- 显式 `schemaVersion: 0` 迁移为完整 v2 空文档并保留 legacy project 基础信息。
- 显式 schema v1 迁移为 v2：旧 StepSpec 拆成 `specStatus + StepRuntime`，旧 RequirementVersion 形成可审计的 legacy reference envelope 并重新计算 payload SHA，旧 ActionIntent 补齐语义字段，Checkpoint 补齐 runtime ref，Audit 链重新规范化。
- 缺少版本、冲突版本、未来版本或迁移后的引用/hash 不一致均 fail closed。
- 读取迁移结果不会偷偷覆盖原文件；下一次成功 transaction 才以相同 atomic rename 写回 v2。

## 已知限制

JSON 文件适合本地、有限规模、单写者 foundation，不宣称多进程 ACID。多进程/独立 CLI writer、写放大或数据集增长达到阈值时必须按 `AUT-1-PERSISTENCE-ADR.md` 重新评审并迁移。
