# WebGPT V1 Capability Matrix

## 说明

本表只列当前生产代码中存在、且在自动化契约或已记录 real smoke 中有证据的能力。`Real evidence` 与 `Contract evidence` 分开，不把 CLI/static test 冒充网页人工结果。WEB-6.9 不发送新的真实 Prompt。

## Desktop / Browser

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `webgpt open` | PASS | WEB-6.5/6.6 CLI real smoke | 打开单一 WebGPT Runtime |
| `webgpt status` | PASS | CLI real smoke + contract | 输出 bounded page/runtime status |
| `webgpt current` | PASS | contract + implementation | 当前 URL 不是 Task identity |
| `webgpt close` | PASS | WEB-6.5R/CLI contract | graceful close；不强杀、不冷启动 |
| `webgpt screenshot --out` | PASS | implementation/contract | debug/evidence only，不参与完成状态 |
| `webgpt control user` | PASS | arbiter/request tests | 用户控制优先，自动队列暂停 |
| `webgpt control auto` | PASS | arbiter/request tests | 显式交还后才恢复自动操作 |
| `webgpt new-chat` | PASS | implementation/contract | 通过真实页面动作创建/准备新 Chat |
| `webgpt open-chat --url` | PASS | page/URL contract | 仅允许 ChatGPT Chat URL |

## Request lifecycle

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `send --text/--file` | PASS | Request Manager tests + CLI contract | 可选 idempotency；网页真实 Prompt 不在本阶段新增 |
| `wait --request-id` | PASS | Request Manager tests | 超时不等于取消 |
| `result --request-id [--out]` | PASS | output tests + CLI contract | UTF-8、独占写出、结果完整性校验 |
| `request status --request-id` | PASS | implementation/contract | 可触发受限 reconcile |
| `request list --active` | PASS | implementation/contract | 只列 active 范围 |
| Request Journal persistence | PASS | restart/idempotency tests | 未完成项不盲目重发 |
| same-key reattach | PASS | idempotency tests | semantic drift -> `IDEMPOTENCY_CONFLICT` |

## Role Registry

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `role list --project --json` | PASS | role contract | 仅 REQUIREMENT/PLANNER/REVIEWER |
| `role status` | PASS | role service tests | exact Project-scoped binding |
| `role new` | PASS | role service tests | 新 Role 先为 `PENDING_CHAT_URL` |
| `role bind --url` | PASS | registry tests | 明确 URL、显式 replace 才可覆盖 |
| `role open` | PASS | role service/target tests | 不 fallback current Chat |
| `role latest` | PASS | WEB-6.5R Fresh Chat Gate | 精确目标页，目标不匹配 fail-closed |
| `role latest --out` | PASS (safe fail-closed) | WEB-6.5R/CLI contract | 目标页无法确认时不产出错误结果文件 |
| Role send | PASS (contract) | role request tests | 不扫描 history，不 silent rebind |

## Project lifecycle

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `project inspect --name` | PASS | WEB-6.8 real smoke | hover row 后只收集 bounded DOM metadata |
| `project open --name` | PASS | WEB-6.8 real smoke | route/context/composer confirmation |
| `project create --name` | PASS | WEB-6.8 real smoke | 真实 Project identity；不发送 Prompt |
| duplicate Project create | PASS | WEB-6.8 real smoke | duplicate 前拒绝浏览器动作 |
| `project new-chat --name` | PASS (context) | WEB-6.8 real smoke | 无 Prompt 时只准备 Project context，不伪造 Chat URL |
| Project delete | NOT IN V1 | scope boundary | 不列为已实现能力 |
| Project rename | NOT IN V1 | scope boundary | 不列为已实现能力 |

## Control Plane / CLI output

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| initialize handshake | PASS | WEB-6.6 protocol smoke | 现代请求必须先初始化 |
| capability/schema | PASS | WEB-6.6 + generated schema | single-source schema |
| version mismatch | PASS | WEB-6.6 fixture | machine-readable rejection |
| unsupported capability | PASS | WEB-6.6 fixture | machine-readable rejection |
| Error Envelope | PASS_WITH_COMPATIBILITY_SCOPE | WEB-6.7 tests + WEB-6.9 CLI exception test | public CLI JSON canonical code + bounded details；raw legacy compatibility path may retain legacy code |
| BUSY / OVERLOADED split | PASS | WEB-6.7 arbiter tests | resource occupied vs queue capacity |
| human stdout/stderr | PASS | Presenter tests | 业务与展示分离 |
| `--json` | PASS | Presenter tests | one JSON line |
| `--out` | PASS | output tests | only supported read/result commands |
| exit code 0/1/2 | PASS | Presenter tests | success/business/argument |

## 非能力 / 明确排除

```text
Automation / Workflow / Planner continuation / Scheduler
Runtime Health/Metrics product layer
State Awareness replacement
multi-account / multi-session
Project Delete/Rename/Migration/Batch
完整 ChatGPT Transcript persistence
Private ChatGPT API client
```

## Evidence posture

`PASS` 表示当前代码和既有证据支持该能力的冻结语义；不表示所有网页状态都被私有 API 直接观察。网页 Completion 仍使用 Network candidate + Page Probe 最终确认，Project new-chat 仍是无 Prompt 的 context preparation。
