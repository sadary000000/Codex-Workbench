# ARCH-V2-6 FIX ROUND 1 — Provider Execution Boundary 收口

## Gate

```yaml
stage: ARCH-V2-6 FIX ROUND 1
result: PASS_CANDIDATE
base_commit: c0bda93
implementation_commits: [b8591db, 6de4b5f, a034737, 0d362b7, 9a49338]
review_evidence_commit: f8fcb17
current_head: 9a49338
v1_frozen_core_changed: NO
real_business_prompt_sent: NO
gate: READY_FOR_GPT_REVIEW
```

本轮针对上一轮 GPT 的 `FIX_REQUIRED` 收口两个 P1：

- **P1-01 legacy URL-shaped seam**：Requirement/Planner/Stage/Step/Action/External Action 相关兼容字段全部有机器可读分类和字段 inventory；只有 opaque `WebGptAutomationProviderPort` 标为 `ACTIVE_PRODUCTION`。
- **P1-02 policy/capability/correlation**：submit/reconcile 在 provider side effect 前要求 pinned `policyVersionId`、完整 `EffectivePolicyDecision`、READY `RuntimeCapability` 和 `ActionAttempt` correlation；拒绝路径不进入 provider submit。

GPT 上一轮提出的 P2（真实 App Server smoke）仍按本轮约束不执行：不发送真实业务 Prompt，仅提交 contract/static/isolated fixture 证据。

## Scope resolution

### In scope

- provider seam 分类、字段 inventory 和旧 AUT paused fail-closed；
- Provider Port 的 policy/capability/ActionAttempt correlation closure；
- RequestManager 的 pinned policy 透传与 idempotency/policy pin mismatch 保护；
- reconcile 的 `VERIFY` 无预算语义；
- production composition root 的单次 Provider Port 构造；
- ARCH-V2-3/4/5 回归、证据和审查包。

### Out of scope

- Automation / Planner / Workflow 的正式启用；
- V1 Native Thread、Native Turn/Item、RuntimeRegistry、Conversation truth；
- WebGPT 页面逻辑、真实 App Server 业务交互；
- cancel 的 provider-side implementation；
- 任何真实业务 Prompt。

## Changes

### 1. Seam classification / opaque boundary

`src/automation/provider-seam-classification.ts` 现在登记完整字段 inventory：

| seam | classification | submit/reconcile | 说明 |
|---|---|---:|---|
| `webgpt-provider-port.ts` | `ACTIVE_PRODUCTION` | yes | 仅 opaque `providerTargetRef` |
| `adapters.ts` | `LEGACY_READ_ONLY` | no | 旧兼容接口 |
| `aut2-real-webgpt-gate.ts` | `PAUSED_NOT_EXECUTABLE` | no | AUT-2 paused |
| `aut3-real-planner-gate.ts` | `PAUSED_NOT_EXECUTABLE` | no | AUT-3 paused |
| `requirement-service.ts` | `PAUSED_NOT_EXECUTABLE` | no | Requirement 兼容调用方 |
| `requirement-webgpt-contract.ts` | `PAUSED_NOT_EXECUTABLE` | no | Requirement 兼容契约 |
| `requirement-webgpt-adapter.ts` | `PAUSED_NOT_EXECUTABLE` | no | Requirement 旧 adapter |
| `planner-service.ts` | `PAUSED_NOT_EXECUTABLE` | no | Planner 兼容调用方 |
| `planner-webgpt-adapter.ts` | `PAUSED_NOT_EXECUTABLE` | no | Planner 旧 adapter |
| `schema.ts` / `store.ts` / `types.ts` | `PAUSED_NOT_EXECUTABLE` | no | 旧持久化兼容字段 |
| `webgpt-external-action.ts` | `TEST_ONLY` | no | 回归 fixture/旧 bridge |
| `webgpt-action-readiness.ts` | `LEGACY_READ_ONLY` | no | 只读 readiness 分类 |

静态 Gate 按文件名和精确字段集合核对，manifest 自身不参与被审计 seam。active Provider Port 不携带 URL-shaped Automation field；ChatGPT URL 只在 WebGPT adapter 内部解析/回读。

### 2. Paused runtime protection

`src/main/main.ts` 在启动旧 AUT 环境标志时先输出：

```json
{
  "code": "PAUSED_NOT_EXECUTABLE",
  "promptSent": false,
  "providerSubmitCount": 0,
  "providerReconcileCount": 0
}
```

然后 fail closed，不启动 AUT-2/AUT-3 旧执行路径；不创建替代 Thread、不切换当前 Chat、不写第二 Transcript truth。正常启动只在 composition root 构造一次 Provider Port，构造本身不 dispatch、不 reconcile、不发送 Prompt。

### 3. Authorization closure

`src/automation/adapters.ts`、`src/features/webgpt/automation/webgpt-provider-port.ts` 和 `src/automation/webgpt-policy-authority.ts` 的关键约束：

- operation 与 `SUBMIT` / `RECONCILE` 对齐；
- policy pin 非空，且与 `EffectivePolicyDecision.effectivePolicy.policyVersionId` 及 correlation 一致；
- decision 必须为 `ALLOW`；
- capability 必须有 version/runtimeId、`READY` 状态，并支持所需 operation；
- ActionIntent/ActionAttempt identity、idempotency、semantic、target/request record 必须一致；
- accepted record 回读不一致时 fail closed，不 retry、不换 target；
- submit 使用 `PROMPT`；reconcile 使用 `VERIFY`，不占用 retry budget；
- cancel 当前没有 executable provider implementation，显式返回 unsupported，不能把 `undefined` 当成功。

### 4. RequestManager / composition root

`WebGptRequestManager` 接受明确的 `policyVersionId`，同 idempotency key 不能静默换 pin；生产模式缺少 pin 直接抛出 `POLICY_PIN_REQUIRED`，browser submit count 为 0。`getWebGptProviderPort()` 在 main composition root 注入 persisted policy authority、runtime capability reader 和 ActionAttempt 校验；旧 AUT 调用方仍被 paused gate 隔离。

## Tests and evidence

| 检查 | 结果 |
|---|---:|
| `npm run check` | PASS |
| `npm test` | **347/347 PASS** |
| Provider boundary + evidence correlation | **11/11 PASS** |
| ARCH-V2-3/4/5 regression | **27/27 PASS** |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| secret scan | PASS — 无 secret-shaped literal |
| `git diff --check` | PASS；仅 LF/CRLF normalization warning |
| isolated `npm run package:win` | PASS |

定向覆盖包括：URL-shaped 字段 inventory、paused submit/reconcile、缺 pin、DENY、缺 capability、完整 allow proof、ActionAttempt correlation、accepted record identity、observe 与 reconcile 分离、VERIFY 无预算和 production composition 静态断言。

### Package provenance

标准 `dist/package` 仍被正在运行的 Workbench EXE 锁定，未强杀进程、未删除文件。隔离打包输出：

```text
D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-6-fix-round-1d\package\Codex Workbench V1.exe
```

隔离 GUI EXE SHA-256：

```text
31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
```

隔离 CLI EXE SHA-256：`50A980F536B79715EC74EFE56C7BE9E7EB3839523B0A60A5B732ACC21F9C3DC4`。

打包资源 SHA-256：`main.js=395233ABE6B95C98B8EFF88B73916778A8446565CC616C1BE32D4202A5B97A8B`、`renderer.js=400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB`、`preload.cjs=09D0EFBB1BD3C7BF02DA6A98EE4AA79D1AA5BFFE60134708B13B2551387B38A2`。

审查包哈希以同目录 `.zip.sha256` sidecar 为准；报告不内嵌自身 ZIP 哈希，避免循环证明。

## Subagents

本轮五个子代理均已自然完成；没有因耗时被催停，Gate 前 `running_subagents=0`。它们均未修改产品文件、未提交、未发送真实 Prompt；当前没有活动中的子代理运行项。

| agent | 任务 | 结果 | 状态 |
|---|---|---|---|
| A `01a02e62-ce11-7502-bfac-b401cd34741d` | provider boundary / URL seam 差距审计 | 采纳：旧 AUT 只保留 paused/test-only；main 需有 composition guard | COMPLETE / no active runtime |
| B `01a02e60-7f6f-72c0-8204-59fb273d1c30` | executable DTO opaque `providerTargetRef` / `ExternalRef` 审计 | 采纳：精确文件/类型 inventory、paused caller 保护、record 回读、reconcile 无预算、cancel fail closed | COMPLETE / no active runtime |
| C `01a02e62-d0a7-7233-ae0e-a6501f5b0d00` | policy/capability/action correlation 只读审计 | 采纳：单一预算 owner、完整 EffectivePolicy、RuntimeCapability、ActionAttempt 回读 | COMPLETE / no active runtime |
| D `01a02e62-d381-7752-a749-6abc26509d29` | regression/static Gate 审计 | 采纳：完整字段 inventory、main runtime guard、测试夹具回归 | COMPLETE / no active runtime |
| E `01a02e62-d6d4-74e0-b0b8-86746f73e8dc` | persistence / paused AUT-2/AUT-3 安全审计 | 采纳：paused 先于 persistence/provider side effect，旧 gate 不得真实执行 | COMPLETE / no active runtime |

## Limitations / blockers

1. 标准 `dist/package` 暂不能更新，原因是用户正在运行的 EXE 锁定 `d3dcompiler_47.dll`；隔离 package 已 PASS。
2. 没有真实 App Server smoke，也没有真实业务 Prompt；这是本轮明确约束，P2-01 保留为非阻塞限制。
3. legacy URL-shaped compatibility data 尚未迁移为新 schema；它们被明确限制在 paused/test-only/read-only seam，不得作为 active executable DTO。
4. cancel 尚无 provider-side implementation；当前只能显式 fail closed。
5. active Provider Port 的 composition-root input resolver 仍是 fail-closed placeholder，Automation 尚未启用；本轮不扩展 Automation scope。

旧 donor `D:\办公\AI\Codex_Workbench` 保持只读；`D:\办公\AI\Auto_Agent` 保持 clean。V1 Frozen Core 未修改。

## Review decision

```yaml
p1_01_legacy_seam_classification: PASS
p1_02_authorization_closure: PASS
p2_01_real_appserver_smoke: NON_BLOCKING_NOT_RUN
tests: PASS
subagents: 5_COMPLETE_ARCHIVED
running_subagents_at_gate: 0
result: PASS_CANDIDATE
gate: READY_FOR_GPT_REVIEW
```
