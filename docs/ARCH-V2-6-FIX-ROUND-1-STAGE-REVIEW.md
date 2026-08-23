# ARCH-V2-6 FIX ROUND 1 — Provider Execution Boundary

## Gate summary

```yaml
stage: ARCH-V2-6 FIX ROUND 1
result: PASS_CANDIDATE
base_commit: c0bda93
implementation_commits: [b8591db, 6de4b5f]
gate: READY_FOR_GPT_REVIEW
v1_frozen_core_changed: NO
real_business_prompt_sent: NO
```

本轮按 GPT 上一轮 `FIX_REQUIRED` 反馈收口两个 P1 问题：

1. **P1-01 — legacy URL-shaped provider seam classification**：所有遗留 URL-shaped provider target seam 均进入明确的 `ACTIVE_PRODUCTION`、`PAUSED_NOT_EXECUTABLE`、`TEST_ONLY` 或 `LEGACY_READ_ONLY` 分类；只有当前 opaque `WebGptProviderPort` 可执行。
2. **P1-02 — Provider Port authorization closure**：所有副作用 submit/reconcile 路径要求同一 `policyVersionId`、完整 `EffectivePolicy`、READY `RuntimeCapability` 和 `ActionAttempt` correlation；缺 pin、DENY 或 capability 缺失均 fail closed，provider submit count 保持 0。

GPT 反馈中的 P2-01（无真实 App Server smoke）本轮仍按约束保留为非阻塞限制：本轮不发送真实业务 Prompt，使用 contract/static/fixture 证据。

## Scope resolution

### In scope

- provider seam 分类及 paused gate 的可执行性边界；
- Provider Port 的 policy/capability/correlation authorization closure；
- missing policy pin、DENY、missing capability、valid pinned policy fixture；
- ARCH-V2-3/4/5 contract regression；
- review evidence 与 provenance。

### Out of scope

- Automation / Planner / Workflow；
- V1 Native Thread、RuntimeRegistry、Conversation truth、Project lifecycle；
- WebGPT 页面逻辑或真实 App Server 业务交互；
- 任何真实业务 Prompt。

## Implementation

### 1. Legacy seam classification

新增 `src/automation/provider-seam-classification.ts`，明确登记：

| seam | classification | executable submit/reconcile |
|---|---|---|
| `webgpt-provider-port.ts` | `ACTIVE_PRODUCTION` | yes |
| `aut2-real-webgpt-gate.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `aut3-real-planner-gate.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `adapters.ts` | `LEGACY_READ_ONLY` | no |
| `requirement-service.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `requirement-webgpt-contract.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `requirement-webgpt-adapter.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `planner-service.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `planner-webgpt-adapter.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `schema.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `store.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `types.ts` | `PAUSED_NOT_EXECUTABLE` | no |
| `webgpt-external-action.ts` | `TEST_ONLY` | no |
| `webgpt-action-readiness.ts` | `LEGACY_READ_ONLY` | no |

`src/main/main.ts` 对 AUT2/AUT3 paused gate 环境标志 fail closed，并记录 `PAUSED_NOT_EXECUTABLE`、`promptSent: false`、`providerSubmitCount: 0`，不启动可执行 Provider Port。

### 2. Authorization closure

`src/automation/adapters.ts` 与 `src/features/webgpt/automation/webgpt-provider-port.ts` 现在要求：

- operation 必须与 `SUBMIT` / `RECONCILE` 一致；
- `policyVersionId` 必须存在且与完整 `effectivePolicy.effectivePolicy.policyVersionId` 一致；
- policy decision 必须是 `ALLOW`；
- runtime capability 必须有 capability version、runtime id，且 status 为 `READY`；
- `actionAttemptId`、request/target/policy correlation 必须保持一致；
- provenance 由同一授权证明携带，不由 adapter 生成新的 policy decision。

`src/automation/webgpt-policy-authority.ts` 只评估/授权已 pin 的 policy；submit 使用 `PROMPT`，reconcile 使用独立的 `VERIFY` 语义，不把验证误记为 retry。缺 pin 或 capability 不可用时抛出 fail-closed 错误，不生成替代 policy、不覆盖调用方 identity。

生产组合根 `getWebGptProviderPort()` 注入 pinned policy authority、runtime capability reader 和 `ActionIntent`/`ActionAttempt` 持久化校验；Provider Port 在副作用前验证 correlation，成功 submit 将同一 `policyVersionId` 传入 Role session，并校验返回 Request identity。

### 3. Opaque target boundary

active Provider Port 只接受 `webgpt-role-v1:<project>:<role>` opaque target ref；它内部按 Role binding 解析目标 Chat。URL-shaped target 仅作为 legacy/test/paused evidence 存在，不进入 production executable port。

## Independent Subagent D audit

本环境没有可调用的 multi-agent spawn 工具，因此没有创建新的可见 user-owned 子代理线程；为避免伪造子代理结果，以下记录实际完成方式：

```yaml
agent: D (read-only audit execution; multi-agent callable unavailable)
task: ARCH-V2-6 tests + ARCH-V2-3/4/5 regression audit
natural_completion: YES
result: PASS
adopted: evidence only
validation: target 9/9; ARCH-V2-3/4/5 27/27
final_status: COMPLETE
closed_after_result: NOT_APPLICABLE (no thread created)
real_prompt_sent: NO
temporary_output: C:\Users\sadar\AppData\Local\Temp\arch-v2-6-subagent-d-audit-20260823
```

D audit 覆盖：

- static field-leak / URL-shaped seam inventory；
- missing policy pin；
- denied policy；
- missing runtime capability；
- valid pinned policy + READY runtime capability isolated fixture；
- ARCH-V2-3/4/5 existing regression tests。

## Test matrix

| command / evidence | result |
|---|---|
| `npm run check` | PASS |
| `npm test` | **345/345 PASS** |
| ARCH-V2-6 provider boundary + evidence correlation | **9/9 PASS** |
| ARCH-V2-3/4/5 regression | **27/27 PASS** |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| changed source/test secret scan | PASS — no secret-shaped literals |
| `git diff --check` | PASS — only Git LF/CRLF normalization warnings |
| isolated `npm run package:win` | PASS |

### Isolated package evidence

为避开正在运行的标准 package EXE 文件锁，本轮使用：

```powershell
$env:CODEX_WORKBENCH_DIST='dist-stage-arch-v2-6-fix-round-1c'
npm run package:win
```

输出：

- `D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-6-fix-round-1c\package\Codex Workbench V1.exe`
- `D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-6-fix-round-1c\package\Codex Workbench CLI.exe`
- `D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-6-fix-round-1c\package\Codex Workbench CLI Runtime.exe`

SHA-256：

```text
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC  Codex Workbench V1.exe
9714AE09B17FFBC96C546B783D27C2F71919699ABBC9D1783BFD0FEB39144255  Codex Workbench CLI.exe
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC  Codex Workbench CLI Runtime.exe
```

对应打包资源 hash（最终隔离构建 `dist-stage-arch-v2-6-fix-round-1c`）：

```text
395233ABE6B95C98B8EFF88B73916778A8446565CC616C1BE32D4202A5B97A8B  dist\main\main.js
400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB  dist\renderer\renderer.js
09D0EFBB1BD3C7BF02DA6A98EE4AA79D1AA5BFFE60134708B13B2551387B38A2  dist\preload\preload.cjs
```

### Standard package limitation

`npm run build` 对标准 `dist/package` 的更新仍被四个正在运行的 `Codex Workbench V1.exe` 进程锁住，具体为 `dist/package/d3dcompiler_47.dll` 的 `EPERM unlink`。本轮没有强杀进程，也没有删除或覆盖标准 package；隔离 package 已作为本轮构建证据。

## Regression and safety boundary

- 未修改 Native Thread / Native Turn / Native Item 事实源；
- 未修改 RuntimeRegistry、Conversation truth 或 WebGPT 页面逻辑；
- 不产生替代 Thread，不回退到当前 Chat，不发送真实业务 Prompt；
- `webgpt-provider-port.ts` 的 side-effect path 不接受 caller 自带的 policy decision，必须经过 authority；
- 旧 donor `D:\办公\AI\Codex_Workbench` 未修改；
- `D:\办公\AI\Auto_Agent` 保持 clean。

## Known limitations / blockers

1. 标准 `dist/package` 当前不能更新，原因是用户运行中的 EXE 文件锁；不能在未获授权时强杀。最终隔离构建已 PASS。
2. 未执行真实 App Server smoke / real business Prompt，符合本轮 GPT 约束；P2-01 继续作为非阻塞限制。
3. `cancel` 没有 active executable implementation；本轮只保证已有 submit/reconcile side-effect path 的 authorization closure。

## Review decision

```yaml
p1_01_legacy_seam_classification: PASS
p1_02_authorization_closure: PASS
p2_01_real_appserver_smoke: NON_BLOCKING_NOT_RUN
tests: PASS
result: PASS_CANDIDATE
gate: READY_FOR_GPT_REVIEW
```
