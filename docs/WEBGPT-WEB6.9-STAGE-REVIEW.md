# WEBGPT WEB-6.9 Stage Review

## 1. Executive Summary

```yaml
stage: WEB-6.9 WebGPT V1 Final Freeze Review
result: PASS_CANDIDATE
base_commit_before_freeze: 1e356db
product_code_changed: YES_MINIMAL_FREEZE_FIXES
v1_core_changed: NO
automation_layer_changed: NO
new_real_prompts: 0
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```

本阶段完成 WebGPT V1 冻结审查、边界核对、两项最小可靠性修复和最终资料收口。没有新增 Automation、Runtime Health、State Awareness、多账号/多 session、Project Delete/Rename 或完整 Chat Transcript 能力，也没有修改 Native Thread / Turn / Item、RuntimeRegistry、V1 Map 或 Native Core。

## 2. Upstream Status and Evidence Posture

| 阶段 | 冻结状态 | 本阶段处理 |
|---|---|---|
| WEB-6.5R | PASS_FROZEN（沿用上游状态） | exact-target 代码/自动化证据复核；真实 Role wrong-chat recovery 仍为 UNKNOWN |
| WEB-6.6 | PASS_FROZEN（沿用上游状态） | initialize/capability/schema/Named Pipe 复核；历史 hash 不作为当前包证明 |
| WEB-6.7 | PASS_FROZEN（沿用上游状态） | taxonomy/Envelope/Presenter/BUSY-OVERLOADED 回归 |
| WEB-6.8 | PASS_CANDIDATE（沿用最近证据） | Project create/open/inspect/new-chat context 复核；历史 summary/review 矛盾保留为证据限制 |

上游旧报告和已删除的旧 `dist/review` artifacts 未被恢复或改写。最终包只包含本次生成的冻结文档，避免把历史矛盾、用户本地文件或网页私密数据包装成当前通过证据。

## 3. Freeze Gate Matrix

| Gate | 结果 | 当前依据 |
|---|---|---|
| single_browser_runtime | PASS | 一个 `WebGptWorkspace` / `WebContentsView` / Session / Network Observer / Arbiter |
| persistent_session | PASS | `session.fromPath(.../webgpt/session)` |
| browser_lease_capacity_1 | PASS | Arbiter capacity=1，BUSY 与 OVERLOADED 分离 |
| user_control_priority | PASS | USER_CONTROL 暂停自动队列，必须显式交还 |
| request_identity | PASS | requestId + idempotencyKey + semanticSha256 |
| idempotency_no_resend | PASS（代码/自动化） | same-key reattach、semantic conflict、restart no-blind-replay 测试 |
| restart_recovery | PASS（代码/自动化） | 未完成 Journal 转为 RECOVERY_REQUIRED，不自动重发 |
| real_inflight_restart_no_resend | UNKNOWN | WEB-6.9 禁止新增真实 Prompt；上游真实 Gate 受限流未完成 |
| completion_state | PASS | Network candidate → bounded Page Probe → final confirmation |
| role_exact_target | PASS（代码/自动化/既有证据） | exact Project+Role binding，无 current-chat fallback |
| real_role_wrong_chat_recovery | UNKNOWN | 0 Prompt 政策下未新增真实 Role send/recovery |
| project_lifecycle | PASS（当前 scope） | Project inspect/open/create/new-chat context，不伪造无 Prompt Chat URL |
| project_registry_recovery | PASS（本阶段修复后） | 非法/重复持久化记录整体拒绝加载，不再静默丢 identity |
| official_cli_abi | PASS（本阶段修复后） | execFile/shell=false、stdio/exit 转发、异常 `--json` envelope |
| control_plane | PASS_WITH_COMPATIBILITY_SCOPE | canonical public Presenter；raw legacy parser/auth errors 保留兼容码 |
| remote_browser_security_boundary | PASS | sandboxed WebContentsView、无 preload、allowlist、权限/下载/新窗口拒绝 |
| browser_cookie_token_export | NO | 未发现读取/导出 Cookie、Browser Token 或 response body 的路径 |
| v1_core_integrity | PASS | 没有 WebGPT → Native Core 业务依赖 |
| automation_started | NO | 明确不在本阶段 |

## 4. Minimal Freeze Fixes

### 4.1 Project Registry fail-closed

文件：`src/features/webgpt/runtime/webgpt-project-registry.ts`、`tests/webgpt-project-registry.test.ts`。

此前 `projects.json` 的单条非法记录、Project ID/URL 不一致或重复身份会被 `continue` 静默丢弃。现在加载时对记录类型/字段、允许的 Project route、ID/URL 一致性和重复 identity 做整体校验；失败返回 `PROJECT_REGISTRY_INVALID`，拒绝部分加载，不创建替代 Project、不改写远端 identity、不删除原文件。

### 4.2 CLI exceptional JSON envelope

文件：`src/main/webgpt-cli-presenter.ts`、`src/main/main.ts`、`tools/official-cli/Program.cs`、`tests/webgpt-control-reliability.test.ts`。

官方 CLI wrapper 缺失 Runtime、启动异常以及 Electron CLI 未处理异常，现在在 `--json` 下都输出单行机器可解析错误 Envelope；文本模式仍走 human stderr。异常消息使用固定安全文本，不把本机路径或原始异常写进 JSON。

## 5. Frozen Architecture Boundary

```text
Native Thread / Turn / Item = V1 Native runtime truth
WebGPT extension = one Browser Runtime + persistent session
                  + Control Plane / Official CLI
                  + Request Manager / Journal + Browser Lease
                  + Role / Project registry
                  + Network candidate + Page Probe
```

WebGPT 不是第二套 Codex，不建立第二套 Conversation、Transcript、Task、Agent lifecycle、Context 或 Exec-history truth。WebGPT 的 request/result/recovery 是受限请求侧数据，不替代 Native 事实源。

## 6. CLI / Control Plane Disposition

- 对外 canonical error taxonomy 保持 11 个稳定 code；CLI Presenter 把 legacy runtime code 归一化为 canonical code。
- raw Control Plane 的 parse/auth/legacy compatibility 路径仍可能保留 `CONTROL_*` 历史 code，这是协议兼容策略；现代业务 response 经过 `decorateResponse` 后使用 canonical code。
- Schema 的 `error.code` 保持 bounded string，而不是只允许 canonical enum，以容纳 legacy wire response；public CLI JSON 仍保证 canonical code。
- `--out` 可接受相对或绝对路径，但最终必须落在既有 allowlist；输出使用 UTF-8、独占创建、flush/close 后才报告成功。
- CLI `--json` 成功/失败/参数错误分别使用 exit code 0/1/2；异常路径已补齐 JSON。

## 7. Security / Session Disposition

| 项目 | 结论 |
|---|---|
| 远程 ChatGPT WebContentsView | PASS：contextIsolation、nodeIntegration=false、sandbox=true，无 V1 preload；权限、下载、新窗口、非 allowlist 导航拒绝 |
| 浏览器 Cookie/Session Token | NO EXPORT：代码级未调用 Cookie/header/postData/response-body 导出路径；本包不含 session profile |
| WebGPT Session 持久化 | PASS：独立 `userData/webgpt/session`，关闭不主动清除，以保留用户登录状态 |
| Control Plane authToken | LOCAL TRANSPORT CREDENTIAL：仅用于本机 Named Pipe descriptor 鉴权，不是 ChatGPT Cookie/网页 token；不进入审查包。其 at-rest hardening 不在本阶段改动 |
| Main Workbench shell | TRUSTED LOCAL SHELL：既有 `sandbox:false` 是本地 UI shell 配置；远程 WebGPT view 仍单独 sandboxed。本阶段不重做 V1 壳架构 |
| 日志脱敏 | SCOPED：Control Plane response 使用安全消息和 bounded allowlist details；未观察到实际凭据命中。通用 logger 全面 sanitizer 不在本阶段扩大实现 |

## 8. Completion / Role / Project

- `loadingFinished` 只能产生 `COMPLETION_CANDIDATE`，Page Probe 必须确认目标 Chat、User/Assistant 计数、Composer/generating 状态和稳定输出。
- Role 使用 Project + Role exact Chat binding；目标不匹配时返回 mismatch/recovery，不扫描 Sidebar/history，不 fallback 当前 Chat。
- Project create 必须确认远端 identity；duplicate 在新的浏览器动作前拒绝。
- Project new-chat 在无 Prompt 时只准备 Project context，第一次 Prompt 才 materialize 真实 Chat identity。

## 9. Automated Verification

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS（213/213） |
| `npm run build` | PASS（Control Plane Schema PASS） |
| `npm run package:win` | PASS（标准 `dist/package`，C# wrapper 无 warning） |
| `npm audit --omit=dev` | PASS（0 vulnerabilities） |
| `git diff --check` | PASS（仅 CRLF 转换提示，无 whitespace error） |
| scoped high-confidence secret scan | PASS（0 credential hit） |

本阶段新增真实 Prompt 数量为 `0`。未把静态、contract 或旧 real smoke 证据冒充为新的真实网页验证。

## 10. Package Provenance

最终标准包：`D:\办公\AI\Codex_Workbench_V1\dist\package`。最终哈希见 `docs/WEBGPT-WEB6.9-PROVENANCE.txt`；本次 package:win 后实际测得：

审查 ZIP：`dist/review/WEBGPT-WEB6.9-FINAL-FREEZE-REVIEW-PACKAGE.zip`；ZIP hash 在交付前单独重算，不写入 ZIP 内部以避免自引用。

```text
Codex Workbench V1.exe          31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
Codex Workbench CLI.exe         FF22000156D1817183715624328C539CC6163160F415255B0C2A6725161D7A35
Codex Workbench CLI Runtime.exe 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
main.js                         0C91AD0F0D0FAFE758709C60E540B42346E9FE58B1765E50936A83655B9C3993
renderer.js                     94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1
package.json                    1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
control-plane.schema.json       7803872B84EEFF714BFA683B51BB3D127BC51DAC95A93AE64B2342745A18EE79
```

## 11. Known Limitations / Deferred Evidence

- 真实 in-flight interruption → restart → same-key no-resend：UNKNOWN；代码/自动化已证明不盲目重发，但本阶段不新增真实 Prompt。
- 真实 Role wrong-chat recovery：UNKNOWN；exact binding/no silent rebind 有代码和测试证据，本阶段不新增真实 Prompt。
- Project Delete/Rename/Migration/Batch：不属于 V1 冻结范围。
- 完整 ChatGPT Transcript：不作为 Workbench 产品事实源。
- Session at-rest encryption/ACL、主壳 sandbox/IPC 深度重做、通用 logger 全面脱敏：不在本阶段扩大架构。
- WEB-6.8 真实 smoke 留下两个测试 Project；删除能力不在 scope，本阶段不删除。
- 历史 WEB-6.8 summary/review/hash 存在矛盾；旧用户文件未被改写，最终包不引用它们作为当前 package provenance。

## 12. Subagents

四个只读审计均已自然完成、结果已审核并关闭；没有子代理修改共享文件：

| 任务 | 结果 | 采用情况 |
|---|---|---|
| Architecture / Truth Boundary | PASS + two UNKNOWN | 采用边界核对和证据限制 |
| Security / Session | remote boundary PASS + scope caveats | 采用安全范围 disposition；未扩大 V1 壳架构 |
| CLI / Control Plane Contract | FOUND FIXABLE GAPS | 采用异常 JSON 修复；legacy/schema/relative `--out` 作为兼容范围记录 |
| Recovery / Regression | FOUND FIXABLE REGISTRY GAP + REAL GATE UNKNOWN | 采用 Registry fail-closed 修复；真实 Prompt 证据保持 UNKNOWN |

```text
running_subagents_at_gate: 0
```

## 13. Final Gate

```text
[WEBGPT_V1_FINAL_FREEZE_REVIEW_READY]
stage: WEB-6.9 WebGPT V1 Final Freeze Review
result: PASS_CANDIDATE
web6_5r: PASS_FROZEN (upstream; real role recovery UNKNOWN)
web6_6: PASS_FROZEN (upstream; old artifact hash not reused)
web6_7: PASS_FROZEN
web6_8: PASS_CANDIDATE (latest evidence; historical summary conflict recorded)
single_browser_runtime: PASS
runtime_recovery: PASS (code/automated; two real cases UNKNOWN)
completion_state: PASS
role_routing: PASS (exact binding; real wrong-chat recovery UNKNOWN)
project_lifecycle: PASS (current scope)
official_cli: PASS
control_plane: PASS_WITH_COMPATIBILITY_SCOPE
security: PASS_WITH_TRUSTED_SHELL_SCOPE
v1_core_integrity: PASS
automated_tests: 213/213
new_real_prompts: 0
automation: NOT_STARTED
known_test_project_residue: YES
implementation_or_review_commit: reported in final handoff; not embedded to avoid commit self-reference
freeze_report: docs/WEBGPT-WEB6.9-STAGE-REVIEW.md
review_package: dist/review/WEBGPT-WEB6.9-FINAL-FREEZE-REVIEW-PACKAGE.zip
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```
