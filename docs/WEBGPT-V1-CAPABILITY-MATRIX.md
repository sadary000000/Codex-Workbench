# WebGPT V1 Capability Matrix

## 说明

本表只列当前生产代码中存在、且在自动化契约或已记录 real smoke 中有证据的能力。`Real evidence` 与 `Contract evidence` 分开，不把 CLI/static test 冒充网页人工结果。WEB-6.9 不发送新的真实 Prompt。

## Desktop / Browser

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `webgpt open` | PASS_REAL | WEB-6.5/6.6 CLI real smoke | 打开单一 WebGPT Runtime |
| `webgpt status` | PASS | CLI real smoke + contract | 输出 bounded page/runtime status |
| `webgpt current` | PASS | contract + implementation | 当前 URL 不是 Task identity |
| `webgpt close` | PASS_REAL | WEB-6.5R/CLI contract | graceful close；不强杀、不冷启动 |
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
| Request Journal persistence | PASS_AUTOMATED | restart/idempotency tests | 未完成项不盲目重发 |
| same-key reattach | PASS_AUTOMATED | idempotency tests | semantic drift -> `IDEMPOTENCY_CONFLICT` |

## Role Registry

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `role list --project --json` | PASS | role contract | 仅 REQUIREMENT/PLANNER/REVIEWER |
| `role status` | PASS | role service tests | exact Project-scoped binding |
| `role new` | PASS | role service tests | 新 Role 先为 `PENDING_CHAT_URL` |
| `role bind --url` | PASS | registry tests | 明确 URL、显式 replace 才可覆盖 |
| `role open` | PASS | role service/target tests | 不 fallback current Chat |
| `role latest` | PASS_REAL | WEB-6.5R Fresh Chat Gate | 精确目标页，目标不匹配 fail-closed |
| `role latest --out` | PASS_REAL | WEB-6.5R/CLI contract | 目标页无法确认时不产出错误结果文件 |
| Role send | PASS_AUTOMATED | role request tests | 不扫描 history，不 silent rebind；复杂 wrong-chat/interruption recovery 仍 `UNKNOWN / EVIDENCE_DEFERRED` |

## Project lifecycle

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| `project inspect --name` | PASS_REAL | WEB-6.8 real smoke | hover row 后只收集 bounded DOM metadata |
| `project open --name` | PASS_REAL | WEB-6.8 real smoke | route/context/composer confirmation |
| `project create --name` | PASS_REAL | WEB-6.8 real smoke | 真实 Project identity；不发送 Prompt |
| duplicate Project create | PASS_REAL | WEB-6.8 real smoke | duplicate 前拒绝浏览器动作 |
| `project new-chat --name` | PASS_REAL (context) | WEB-6.8 real smoke | 无 Prompt 时只准备 Project context，不伪造 Chat URL |
| Project delete | NOT IN V1 | scope boundary | 不列为已实现能力 |
| Project rename | NOT IN V1 | scope boundary | 不列为已实现能力 |

## Control Plane / CLI output

| 能力 | 状态 | 证据 | 约束 |
|---|---|---|---|
| initialize handshake | PASS | WEB-6.6 protocol smoke | 现代请求必须先初始化 |
| capability/schema | PASS | WEB-6.6 + generated schema | single-source schema |
| version mismatch | PASS | WEB-6.6 fixture | machine-readable rejection |
| unsupported capability | PASS | WEB-6.6 fixture | machine-readable rejection |
| Error Envelope | PASS_AUTOMATED (compatibility scope) | WEB-6.7 tests + WEB-6.9 CLI exception test | public CLI JSON canonical code + bounded details；raw legacy compatibility path may retain legacy code |
| BUSY / OVERLOADED split | PASS_AUTOMATED | WEB-6.7 arbiter tests | resource occupied vs queue capacity |
| human stdout/stderr | PASS | Presenter tests | 业务与展示分离 |
| `--json` | PASS | Presenter tests | one JSON line |
| `--out` | PASS | output tests | only supported read/result commands |
| exit code 0/1/2 | PASS | Presenter tests | success/business/argument |

## Frozen capability evidence grading

以下是本次 V1 冻结明确承认的能力与证据等级；`PASS_REAL` 只表示已有真实网页/打包 smoke，`PASS_AUTOMATED` 表示契约、单元或集成自动化，`PASS_CODE_AUDIT` 表示实现边界审计：

| 冻结能力 | 证据等级 | 说明 |
|---|---|---|
| single Browser Runtime | `PASS_CODE_AUDIT` + `PASS_AUTOMATED` | 单 `WebGptWorkspace` / `WebContentsView`，无第二 Runtime |
| persistent Session | `PASS_CODE_AUDIT` + `PASS_AUTOMATED` | Electron session 持久化；不导出 Cookie/Token |
| Browser Lease capacity=1 | `PASS_AUTOMATED` | Arbiter capacity=1，资源占用为 `BUSY` |
| USER_CONTROL priority | `PASS_AUTOMATED` | 用户控制暂停自动队列，必须显式交还 |
| request identity / idempotency / no blind resend / Journal / fail-closed recovery | `PASS_AUTOMATED` + `PASS_UPSTREAM_ACCEPTED` | 代码/自动化 no-blind-resend；WEB-5 最终真实 Gate 证明重启后同 requestId、零重复 Prompt |
| Network `COMPLETION_CANDIDATE` → bounded Page Probe final confirmation | `PASS_AUTOMATED` + prior real integration evidence | 网络流结束只作候选；不需要 image/OCR |
| Official CLI ABI | `PASS_AUTOMATED` + `PASS_CODE_AUDIT` | `execFile`/`shell:false`、稳定 exit code、`--json`/`--out` |
| Control Plane protocol | `PASS_REAL` + `PASS_AUTOMATED` | initialize、capability、schema、Named Pipe 契约 |
| Error Taxonomy / Error Envelope | `PASS_AUTOMATED` | WEB-6.7 contract 与 WEB-6.9 exception JSON 修复 |
| BUSY / OVERLOADED | `PASS_AUTOMATED` | occupied resource 与 queue capacity 分离 |
| CLI Result Presenter | `PASS_AUTOMATED` | stdout、JSON、`--out`、exit code 分层 |
| Role exact binding / role latest / role latest --out | `PASS_REAL` | WEB-6.5R Fresh Chat 正向 Gate；no silent rebind、no current-chat fallback |
| Project inspect/open/create/new-chat context | `PASS_REAL` | WEB-6.8 accepted real smoke；new-chat 无 Prompt 时是 context preparation |
| complex Role send wrong-chat/interruption recovery | `UNKNOWN / EVIDENCE_DEFERRED` | 不作为当前冻结能力，不否定 exact-target routing |

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
