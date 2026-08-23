# ARCH-V2-6 Stage Review

## Scope resolution

```yaml
stage: ARCH-V2-6
official_name: Provider-neutral Ports / WebGPT Adapter Boundary
base_commit: b94ea6a6b21c2420f644e145c02f9ee2cf8f912d
implementation_commit: afdbab8
v1_frozen_core_changed: NO
aut2_aut3_activated: NO
real_business_prompts: 0
review_package: dist/review/ARCH-V2-6-REVIEW-PACKAGE.zip
review_package_sha256: see dist/review/ARCH-V2-6-REVIEW-PACKAGE.sha256
internal_gate: READY_FOR_GPT_REVIEW
```

正式范围来自 GPT 最新审查反馈及其生成的
`Codex_ARCH-V2-6_Provider-Neutral-Ports_WebGPT-Adapter-Boundary_Auto-GPT-Loop.md`。
本轮只处理 Automation → provider-neutral contract → WebGPT provider adapter 的最小垂直链路；AUT-2/AUT-3 仍暂停，不发送真实业务 Prompt，不进入下一阶段。

## Goal and architecture boundary

```text
Automation intent / attempt / receipt
            |
            v
Provider-neutral AutomationProviderPort
            |
            v
WebGptAutomationProviderPort (features/webgpt composition boundary)
            |
            v
RoleSessionService / RequestManager / Browser runtime
```

Automation 侧只应持有 bounded opaque target/request/result/evidence references、状态、能力和 correlation；Chat URL、Role binding 解析、RequestManager、Browser lease 和页面细节由 WebGPT adapter/composition 处理。Native Thread/Turn/Item 与 WebGPT Request Journal 仍各自保持唯一事实源。

## Gate matrix

| Gate | 状态 | 证据 |
|---|---|---|
| A. `src/automation/**` 不直接导入 WebGPT feature | PASS | `tests/arch-v2-6-provider-boundary.test.ts` 静态扫描，当前 0 个 direct import |
| B. Requirement/Planner 使用注入式 port | PARTIAL | concrete type import 已移除，结构化 composition port 已保留；现有 AUT harness compatibility 字段仍含 `chatUrl`/`targetChatUrl` |
| C. provider target opaque | PASS（新 port）/ PARTIAL（legacy seam） | `webgpt-role-v1:<project>:<role>` 仅由 provider adapter 解析；旧 External Action compatibility seam 仍保留 URL 字段 |
| D. provider observation neutral、不得写 Workflow PASS | PASS | `ProviderObservation` 只返回中性状态/result/evidence refs；无 Workflow PASS 写入 |
| E. correlation regression | PASS | bounded immutable `EvidenceCorrelation`、Store selector、targeted test |
| F. capability/policy regression | PARTIAL | provider port 对 runtime/auth/busy 做 fail-closed capability gate；AUT legacy repair budget/policy 迁移不在本轮扩大 |
| G. observe 与 reconcile 分离 | PASS | spy test 证明 observe 只 query，reconcile 只调用显式 reconcile，均不 submit |
| H. AUT-2/AUT-3 pause side-effect count | PASS（本轮 provider negative path） | capability denial 时 submit count=0；未启动 AUT real gate、real prompt count=0 |

本轮结果是 `READY_FOR_GPT_REVIEW`，不是“已完成全量 legacy WebGPT 字段迁移”。未完成部分已列为明确的 out-of-scope/deferred findings，等待 GPT 判断是否进入修复轮。

## Implementation

- `src/automation/adapters.ts`：增加唯一 provider-neutral `AutomationProviderPort` 及 bounded target/request/result/observation/capability/correlation DTO。
- `src/features/webgpt/automation/webgpt-provider-port.ts`：WebGPT provider-owned target ref、目标解析、能力归一化、submit、query-only observe、显式 reconcile。
- `src/features/webgpt/index.ts`：导出 provider adapter 入口。
- `src/automation/requirement-webgpt-adapter.ts`、`planner-webgpt-adapter.ts`、两个 real gate：移除对具体 WebGPT runtime 的 type import，改为注入式 structural composition port。
- `src/automation/webgpt-action-readiness.ts`、`webgpt-external-action.ts`：改用 structural provider views，保留旧兼容 seam；修复注入类方法的 `this` 绑定并保持租约/observe/reconcile 行为。
- `src/automation/evidence-correlation.ts`、`types.ts`、`schema.ts`、`store.ts`：提供 bounded opaque Evidence correlation 与 query-only lookup。
- `tests/arch-v2-6-provider-boundary.test.ts`、`tests/arch-v2-6-evidence-correlation.test.ts`：新增边界、能力 fail-closed、observe/reconcile、相关性测试。

## Provider target and data flow

`createWebGptRoleTargetRef()` 生成 `webgpt-role-v1:` 前缀的 opaque ref。只有
`WebGptAutomationProviderPort` 调用 RoleSession Registry/Service 并读取绑定 Chat；Automation 不解析该 ref，也不接触 Chat URL。Provider observation 只映射为 `RUNNING/COMPLETED/FAILED/INTERRUPTED/UNKNOWN` 以及 result/evidence refs。

## Verification

```yaml
npm_run_check: PASS
npm_test: 340/340 PASS
arch_v2_6_targeted: 14/14 PASS (existing ARCH-V2-4 adapter regression + new tests)
npm_audit_omit_dev: PASS (0 vulnerabilities)
secret_scan: PASS
git_diff_check: PASS
standard_build: BLOCKED_BY_RUNNING_EXE (EPERM on dist/package/d3dcompiler_47.dll)
isolated_build: PASS
isolated_package: PASS
isolated_package_root: dist-stage-arch-v2-6-build/package
isolated_gui_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
isolated_cli_exe_sha256: 0B67D1CE19A91E82D62841AF8C971A46987C77027F3E370FBD8CA9517374FE61
real_business_prompts: 0
aut2_aut3_activated: NO
```

`npm run build` 对标准 `dist` 的第一次尝试因当前运行中的 `Codex Workbench V1.exe` 锁定 Electron 文件而返回 Windows `EPERM`；未强杀进程、未删除标准目录。使用 `CODEX_WORKBENCH_DIST=dist-stage-arch-v2-6-build` 的独立输出重新执行 `npm run package:win` 成功。

## Five independent audit results

五个子代理均自然完成、只读审计、无文件写入，结果已整合后关闭：

1. dependency inventory：确认 HEAD 有 concrete import，工作树已降为 0，但 URL/ref 语义仍需收口。
2. existing adapter inventory：确认现有 External Action seam 可复用，未引入第二套 persistence truth。
3. target/correlation audit：确认旧 Role → Chat URL → RequestRecord 链路及本轮新 opaque target adapter 的边界。
4. regression audit：确认新增静态边界、correlation、observe/reconcile、paused negative tests 必要且全量测试通过。
5. independent challenge：指出 Automation 普通启动写入、stage harness 隔离、legacy URL fields 等不应被本轮伪装为已解决的问题；这些列为后续审查项。

## Known limitations / out of scope

- Requirement/Planner/AUT compatibility harness 的历史输入输出仍使用 `chatUrl`/`targetChatUrl` 命名；本轮没有把 paused AUT harness 重构成独立 StageContext。
- `WebGptExternalActionBridge` 是历史 WebGPT-specific compatibility seam；新 `AutomationProviderPort` 是 provider-neutral 入口，但尚未把全部 legacy Action bridge caller 迁移为统一 generic consumer。
- `main.ts` 中 Automation persistence / policy 初始化与 stage harness 的完整隔离不是本轮目标；不启动 AUT gate，也未发送真实 Prompt。
- policy authority 的全量注入、RequestRecord/lease 视图进一步压缩、旧 URL 持久化迁移需要独立修复轮，不能宣称已完成。
- 未执行真实 App Server/Browser smoke，因为本阶段只需 contract/negative boundary evidence，且 AUT-2/AUT-3 明确暂停。

## Review request

请 GPT 重点审查：

1. 新 provider-neutral Port 是否应成为唯一生产入口；
2. legacy `chatUrl`/`targetChatUrl` compatibility seam 是否必须在下一轮完全迁移；
3. Automation persistence 与 stage harness 隔离是否应提前列为 P0；
4. 是否允许在不激活 AUT-2/AUT-3 的前提下进入下一修复轮。

当前不自动进入 AUT-2/AUT-3 或任何后续阶段。
