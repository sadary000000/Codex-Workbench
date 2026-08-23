# ARCH-V2-7 Persistence Ownership

## Canonical ownership

| Domain | Canonical store | Only production composition | Not canonical |
|---|---|---|---|
| Native Thread/Turn/Item | Codex App Server | Native runtime | Workbench projection / UI transcript |
| V1 project/thread/composer/recovery metadata | `V1PersistenceStore` / `workbench-state.json` | Main persistence boundary | Native history reconstruction |
| Automation entities | `AutomationStore` / SQLite `automation.db` | `createProductionAutomationComposition()` | Direct renderer/provider writes |
| WebGPT request facts | `WebGptRequestManager` / provider-local Journal | WebGPT runtime | Automation workflow truth |
| WebGPT Project/Role bindings | Provider-local registries | WebGPT runtime | Current browser page |

## Rules verified

- Native identity is never replaced by a local projection ID.
- Automation writes use `AutomationStore.transaction()` and its writer lock.
- Read/inspect/list paths do not acquire the writer lock or create missing provider directories.
- Migration is explicit; a query does not rewrite a legacy source.
- Review roots are isolated from production roots and contain no production Journal/profile/cookie/token.

## Known API boundary

`SqliteAutomationPersistence` remains an internal low-level implementation used by migration/tests. Production `main.ts` now obtains the Automation store through the composition root. Future hardening may make the low-level constructor non-exported, but no second production caller was found in this stage.
