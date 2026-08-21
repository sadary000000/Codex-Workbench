# WEBGPT WEB-6.6 Stage Review

## Executive Summary

```yaml
stage: WEB-6.6 Control Plane Protocol Baseline
result: PASS_CANDIDATE
v1_core_changed: NO
automation_layer_changed: NO
new_real_prompts: 0
next_stage_candidate: WEB-6.7（本阶段不进入）
implementation_commit: 3b528cc
```

WEB-6.6 已完成 Control Plane 的版本/能力/Schema 基线、现代 initialize 会话握手、错误边界、官方 CLI handshake 以及兼容窗口验证。它没有修改 Native Thread、Native Turn、Native Item、Runtime Registry、Request Manager 或 WebGPT 核心行为。

## Scope and Architecture Boundary

```text
V1 Frozen Core
    |
    +-- WebGPT Feature
          +-- Electron Browser Runtime
          +-- CLI
          +-- Control Plane
          +-- Request Manager
          +-- Role Registry
```

本阶段只冻结协议契约，不实现 Browser Pane、Automation、Planner、Reviewer、Workflow 或 Project Create。Control Plane 是本地 WebGPT 控制平面，不是第二套 Codex，也不是第二套 Conversation truth。

## Implementation

主要变更：

1. 新增 `src/shared/webgpt-control-plane-contract.ts` 作为版本、capability、命令和 Schema 的单一来源；
2. 为 `src/main/webgpt-control.ts` 增加 initialize、protocol negotiation、session/client 绑定、capability rejection、结构化错误、legacy window 和 safe diagnostics；
3. `src/main/main.ts` 将 Workbench version 注入 descriptor/server，保持现有 Windows Named Pipe 传输；
4. build/package 流程生成并复制 `control-plane.schema.json`；
5. 官方 CLI 先 initialize，再发送业务 command；冷启动 descriptor version 不一致时重新 initialize；
6. 新增 contract/unit tests 和无 Prompt 的 WEB-6.6 protocol real smoke。

## Protocol Gate

| Gate | 结果 | 证据 |
| --- | --- | --- |
| `protocolVersion: 1.0` | PASS | source contract、CLI status、Schema |
| initialize required / field allowlist | PASS | `CONTROL_INITIALIZE_REQUIRED`、`CONTROL_FIELD_UNSUPPORTED` tests |
| capability descriptor/status | PASS | 8 项 capability baseline |
| version mismatch | PASS | real fixture 返回 `VERSION_MISMATCH` |
| unsupported capability | PASS | real fixture 返回 `CAPABILITY_NOT_SUPPORTED` |
| session/client binding | PASS | contract tests + server path |
| legacy compatibility | PASS | bounded window，response 标记 `LEGACY` |
| Named Pipe | UNCHANGED | 仍使用既有 descriptor/authenticated local pipe |
| Schema single source | PASS | build 生成、package 复制、hash 一致 |

## Automated Verification

执行结果：

```text
npm run check                         PASS
npm test                              PASS (198/198)
targeted WEB-6.6 contract tests       PASS (13/13)
npm run build                         PASS
npm run package:win                   PASS
npm audit --omit=dev                  PASS (0 vulnerabilities)
git diff --check                      PASS
scoped secret scan                    PASS
```

本阶段没有 `npm run package` 脚本；Windows package 使用项目现有的 `npm run package:win`，没有伪造命令结果。

## Real App/Control Plane Smoke

证据文件：`dist/review/WEBGPT-WEB6.6-REAL-GATE.json`

执行时间：`2026-08-21T04:32:22.917Z`。使用官方 CLI / Node `execFile` 路径，未发送 Prompt、未创建 Chat、未访问用户聊天内容。

```yaml
newRealPrompts: 0
status_exitCode: 0
protocolVersion: 1.0
compatibilityMode: MODERN
clientType: OFFICIAL_CLI
workbench: READY
webgpt: UNAVAILABLE
version_mismatch: VERSION_MISMATCH
unsupported_capability: CAPABILITY_NOT_SUPPORTED
```

`webgpt: UNAVAILABLE` 是当时没有活动 WebGPT 页面/runtime 的真实状态，不是 Control Plane handshake 失败。descriptor evidence 仅记录 auth token 是否被写入证据（`false`），不记录 token 值。

Schema：

```text
path: dist/contracts/control-plane.schema.json
bytes: 11276
sha256: b4d61e5902a720ba9cf405bce6a91fabe20fcd098bb1ea6ff3383f58e4b4b4db
packaged copy sha256: b4d61e5902a720ba9cf405bce6a91fabe20fcd098bb1ea6ff3383f58e4b4b4db
```

## Regression Boundary

198/198 自动化测试包含既有 V1/WebGPT contract coverage。本阶段没有为了协议 Gate 重跑会发送真实网页 Prompt 的旧 WebGPT real smokes；这遵循 `new_real_prompts: 0` 与账号限流/安全边界。既有 WEB-6.5 role latest 证据中的 `WEBGPT_TARGET_CHAT_MISMATCH` 仍是上游已知限制，本阶段未声称修复它。

未发现需要修改 Frozen Core 的回归问题。

## Security and Compatibility

- descriptor 继续是本机传输发现文件，authToken 只在运行时内存/本地认证链路使用；
- Schema、报告、evidence、ZIP 不含 Cookie、Token、密码、browser profile、Prompt、Assistant transcript 或私人 Chat URL；
- initialize 对字段做 allowlist，现代业务请求要求 session；
- session 默认 30 分钟、最多 64 个，过期或 identity mismatch fail-closed；
- legacy 兼容窗口截止 `2026-12-31T23:59:59.000Z`，到期返回 `CONTROL_LEGACY_UNSUPPORTED`；
- 不使用私有 ChatGPT API，不做网络协议逆向，不改变页面登录/session 管理。

## Subagents

| Agent | 任务 | 结果 | 采用 | 关闭 |
| --- | --- | --- | --- | --- |
| Anscombe (`01a02288-2607-74c3-914e-8a7afe59d54c`) | Control Plane/Named Pipe/auth/request flow audit | 只读审计完成 | 是，作为实现边界核对 | 是 |
| Rawls (`01a02288-26ad-7d03-adfb-08e582477744`) | version/schema/package/build audit | 只读审计完成 | 是，作为契约与产物核对 | 是 |
| Curie (`01a02288-275f-73e2-96f5-c09e2dd2b616`) | tests/real smoke/Gate audit | 只读审计完成 | 是，限制危险 real smoke 范围 | 是 |
| Popper (`01a02288-282c-77b3-a5b7-8a221842f32c`) | security/compatibility/Frozen Core audit | 只读审计完成 | 是，推动字段/脱敏/兼容性修正 | 是 |

四个子代理没有修改共享工作树；`running_subagents_at_gate: 0`。

## Provenance and Protected Inputs

实现提交：`3b528cc feat: establish webgpt control plane protocol baseline`。

最终 package 产物：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
SHA256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC

D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe
SHA256: 3CD0ECA979AC0A6C807C5B2198B6996E6A0F88858075C7D35D12A3D58EFB7809
```

本地 `指导文档/*.docx`、`V1docs.zip`（如存在）、`dist-stage-a/` 均未纳入本阶段提交。旧 donor `D:\办公\AI\Codex_Workbench` 和旧 `D:\办公\AI\Auto_Agent` 保持只读/原状；既有 dirty baseline 未 reset、clean、stash 或覆盖。

## Known Limitations / Deferred

- 本阶段的真实 smoke 是协议层 smoke，不代表 WebGPT 页面已登录或 Browser UI 已验证；
- `webgpt: UNAVAILABLE` 需要在有活动页面的后续阶段另行处理；
- WEB-6.5 role latest 的目标 Chat mismatch 仍待其自身后续修复/审查；
- 没有额外引入 JSON Schema runtime validator，当前由单一 source、生成结果和 contract tests 防漂移；
- legacy window 是迁移过渡，不是长期新接口；
- Browser Pane、Automation、Planner/Reviewer、multi-account/multi-session 均不在本阶段。

## Review Package Contents

最终 ZIP 只包含：本报告、协议基线、操作契约、测试摘要、provenance、changed-files、脱敏 real-gate JSON 和 control-plane Schema；不包含 cookie、token、profile、私聊内容或无关历史日志。

## Gate

```text
[WEBGPT_WEB6_6_PROTOCOL_BASELINE_REVIEW_READY]
stage: WEB-6.6 Control Plane Protocol Baseline
result: PASS_CANDIDATE
protocol_version: PASS
initialize: PASS
capabilities: PASS
version_mismatch: PASS
schema: PASS
schema_single_source: PASS
official_cli: PASS
legacy_compatibility: PASS
named_pipe_unchanged: YES
automated_tests: PASS
198/198
parallel_subagents: 4
v1_core_changed: NO
new_real_prompts: 0
implementation_commit: 3b528cc
review_commit: final documentation/package commit (see git HEAD)
schema_artifact: D:\办公\AI\Codex_Workbench_V1\dist\contracts\control-plane.schema.json
review_report: D:\办公\AI\Codex_Workbench_V1\docs\WEBGPT-WEB6.6-STAGE-REVIEW.md
review_package: D:\办公\AI\Codex_Workbench_V1\dist\review\WEBGPT-WEB6.6-STAGE-REVIEW-PACKAGE.zip
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
```
