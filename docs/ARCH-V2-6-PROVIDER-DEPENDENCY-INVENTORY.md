# ARCH-V2-6 Provider Dependency Inventory

| Area | Current owner | Boundary status |
|---|---|---|
| Automation contracts | `src/automation/adapters.ts` | provider-neutral DTO/Port |
| WebGPT target resolution | `src/features/webgpt/automation/webgpt-provider-port.ts` | provider-owned |
| Role binding / Chat URL | WebGPT RoleSession Registry/Service | not exported through the new Port |
| Request Journal / Browser lease | WebGPT RequestManager/Arbiter | provider-owned |
| Requirement/Planner compatibility | `src/automation/*-webgpt-adapter.ts` | structural injection; legacy field names remain |
| V1 Native runtime | `src/codex` / `src/main` | unchanged |

No cookies, tokens, browser profiles, page contents or private chats are part of this inventory.
