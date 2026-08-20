# WEBGPT WEB-6.4 Stage Review

## Executive Summary

```yaml
stage: WEB-6.4 Global Operation Arbiter & Single Browser Lease
result: PASS_CANDIDATE
v1_core_changed: NO
real_prompt_sent: NO
next_stage: STOP_AND_WAIT_FOR_GPT_REVIEW
```

本阶段在 WebGPT 现有单 `WebContentsView` 上增加全局 Operation Arbiter 和 capacity=1 Browser Lease。目标是把 CLI、内部恢复、Project/Role、导航和发送操作纳入同一浏览器资源边界，同时保持 WEB-5 的幂等、恢复、no-resend 和用户接管语义。

本阶段不进入 WEB-6.5，不实现 Automation、Planner、Reviewer、Workflow 或多浏览器。

## Scope / Architecture Boundary

- Native Thread / Turn / Item、Codex App Server、RuntimeRegistry、Conversation truth、Map 规则和 V1 Renderer Native Composer 未修改。
- WebGPT 是 V1 之上的扩展能力，不建立第二套 Conversation/Transcript/Task truth。
- 自动写操作共享一个浏览器 lease；读诊断只保留有界元数据。
- WEB-6.3 network completion candidate 继续由 Page Probe / Request Manager 最终确认。

## Gate Matrix

| Gate | 结果 | 证据 |
| --- | --- | --- |
| Lease capacity=1 / FIFO | PASS | `tests/webgpt-operation-arbiter.test.ts` |
| double/stale release | PASS | Arbiter unit tests |
| recovery priority | PASS | Arbiter unit tests |
| SEND lease 覆盖 wait timeout | PASS | `tests/webgpt-request-manager.test.ts` |
| USER_CONTROL 抢占和队列保持 | PASS | Arbiter / Request Manager tests |
| AUTO_CONTROL recovery-first | PASS | Request Manager tests |
| Network candidate operation binding | PASS | `tests/webgpt-network-observer.test.ts` |
| Project / Role / navigation 统一 lease | PASS | Request Manager / Role tests |
| V1 regression | PASS | 全量测试 |
| 最新 packaged EXE 多 CLI | PASS | Real Gate JSON |
| 最新 packaged EXE USER_CONTROL fail-closed | PASS | Real Gate JSON |
| 真实 SEND/GENERATING smoke | NOT_RUN | 本阶段 realPromptCount=0，避免触发网页限流 |

## Automated Verification

```text
npm run check         PASS
npm test              PASS (177/177)
npm run build         PASS
npm run package:win   PASS
npm audit --omit=dev  PASS (0 vulnerabilities)
git diff --check      PASS (无 diff 错误)
secret scan           PASS (审查资料及新增 smoke 输出未发现 Cookie/Token/私钥/Authorization/Prompt/回答正文)
```

## Packaged Real Smoke

使用：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
```

通过 Node `execFile` 启动 CLI，并由 smoke harness 显式拥有一个 packaged EXE；没有使用 PowerShell 的 `& exe command`，没有发送真实 Prompt。

```yaml
run_id: web6.4-arbiter-1787251095064-654f7973
project: workts
concurrent_cli_count: 2
real_prompt_count: 0
max_real_prompts: 1
capacity_observed: true
user_control_blocked_auto: true
user_control_error_code: WEBGPT_USER_CONTROL
rate_limit_observed: false
global_new_chat_clicked: false
evidence_sha256: 55C2ED95BF04933298A46FC9B7847CA9BB2920461E28E74BA84CE208BAFD4184
cookies_read: false
tokens_read: false
prompt_body_logged: false
response_body_logged: false
```

两个并发 Project open 的两个 operationId 为：

```text
wgpt-op-4da75367-bb30-49bb-895f-64bbbd012e8d
wgpt-op-b7b5fbc5-bac9-4203-9320-4bdc732435c9
```

它们的 operation timeline 没有重叠，最终资源状态为 `capacity=1 / mode=FREE / queueDepth=0`。由于 smoke 在操作完成后采样 status，本报告不把最终 `queueDepth=0` 宣称为实时排队深度；队列 FIFO 和抢占由确定性测试证明。

USER_CONTROL 后发起 Project open 明确返回 `WEBGPT_USER_CONTROL`，没有静默执行、换 Chat 或创建替代 Chat。AUTO_CONTROL 后首先进行 recovery reconcile，再恢复自动控制。

## Changed Files

产品路径：

- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts`
- `src/features/webgpt/runtime/webgpt-workspace.ts`
- `src/features/webgpt/runtime/webgpt-request-manager.ts`
- `src/features/webgpt/runtime/webgpt-role-session-service.ts`
- `src/features/webgpt/network/network-observer.ts`
- `src/features/webgpt/network/network-types.ts`
- `src/features/webgpt/types.ts`
- `src/main/main.ts`
- `package.json`

测试和 smoke：

- `tests/webgpt-operation-arbiter.test.ts`
- `tests/webgpt-network-observer.test.ts`
- `tests/webgpt-request-manager.test.ts`
- `tests/webgpt-role-session-service.test.ts`
- `scripts/real-webgpt-web6.4-arbiter-smoke.ts`

报告和 evidence：

- `docs/WEBGPT-WEB6.4-GLOBAL-OPERATION-ARBITER.md`
- `docs/WEBGPT-WEB6.4-STAGE-REVIEW.md`
- `dist/review/WEBGPT-WEB6.4-REAL-GATE.json`
- `dist/review/WEBGPT-WEB6.4-TEST-SUMMARY.json`
- `dist/review/WEBGPT-WEB6.4-PROVENANCE.txt`

## Subagents

| Agent | Task | Completion | Adopted | Final status |
| --- | --- | --- | --- | --- |
| Nash | WebGPT control / runtime architecture read-only audit | Natural completion | Adopted as implementation audit input | Completed and closed |
| Ampere | tests / real smoke / provenance read-only audit | Natural completion | Adopted as Gate checklist input | Completed and closed |

两个子代理均未修改文件、未启动 Workbench、未发送真实 Prompt、未修改旧 donor；Gate 前 `running_subagents=0`。

## Provenance

Base commit:

```text
77752978e82de98c91e27842812d3fb9fcf0b735
```

Implementation commit: `c9bd4a6` (`feat: implement webgpt global operation arbiter`).

Review/freeze commit: the documentation/package commit that contains this report and the final WEB-6.4 review ZIP; its exact hash is recorded in the final handoff. No later product-code commit is expected.

最新 package：

```text
D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
```

应用没有 `app.asar`，通过 packaged resources 证明应用内容：

```text
outer EXE:
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC

resources/app/dist/main/main.js:
C0D3A6B738E10A4BE19ED6BB50A3C86B700B8B390AAE007E417714615F39EDD4

resources/app/dist/renderer/renderer.js:
94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1

resources/app/package.json:
1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F

resources/app/dist/features/webgpt/runtime/webgpt-operation-arbiter.js:
054D8CA0F540EC6C0B14F4AA491D982F55776316CF523C14200D5F5495751CF1
```

## Local Files / Donor Protection

- 用户已有 `dist-stage-a/`、历史 spike docs、`指导文档/*.docx` 保持原状态，未加入本阶段 commit。
- 历史已跟踪的旧 review artifacts 在打包后恢复到 HEAD 内容，未删除。
- 旧 donor `D:\办公\AI\Codex_Workbench` 仅记录既有 dirty baseline，未修改、未 reset、未 clean、未 stash。
- `D:\办公\AI\Auto_Agent` 未修改。
- 本阶段不包含 Cookie、Token、Browser profile、密码、Prompt、回答或私人网页正文。

## Known Limitations / Deferred

1. 没有真实 SEND/GENERATING gate；真实新 Prompt 数为 0。发送生命周期由自动化 contract/unit 覆盖，真实限流敏感路径留给用户/GPT 决定是否人工验证。
2. 没有强制造 App Server crash、writer conflict 或 no-rollout；已有 WEB-5 / Stage A recovery 和 isolation 证据继续有效。
3. Browser Pane、Automation、Planner、Reviewer、multi-account、multi-session 均不在 WEB-6.4。
4. 当前没有把普通 read 诊断扩展成并发资源；页面写操作仍是唯一严格 lease 边界。

## Review Request

```yaml
gate: READY_FOR_GPT_REVIEW
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
stop_stage: WEB-6.4
do_not_enter: WEB-6.5
```
