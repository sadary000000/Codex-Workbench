# ARCH-V2-3 Automation Read-only Evidence

## Query contract

`AutomationStore.inspect()`, `get()`, `list()` 与 `snapshot()` 对已有 JSON/SQLite 文件走纯读路径：

- 不获取 writer lock；
- 不创建目录、数据库、表或 metadata；
- 不执行 migration、backup、rename 或 interrupted-migration recovery；
- 旧 SQLite document schema 返回 `needs_migration` 与 `NEEDS_MIGRATION`，而不是隐式迁移。

## Explicit writer boundary

`AutomationStore.migrate()`、`transaction()` 与创建/更新操作保留写入、迁移、恢复和 writer authority 行为。查询调用方必须显式选择这些入口。

## Evidence

`tests/automation-persistence.test.ts` 的 `Automation inspect/get/list are query-only and report legacy SQLite as NEEDS_MIGRATION` 验证：

1. 当前 SQLite 文件读取前后 SHA-256 不变；
2. 查询期间没有 writer-lock 文件；
3. 旧版本文件报告 `needs_migration` 和 `migratedFrom`；
4. 旧版本文件内容保持不变。

同一测试文件中的 migration、interrupted migration 和 single-writer tests 验证显式 writer 路径仍保留原有能力。
