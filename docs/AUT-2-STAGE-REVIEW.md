# AUT-2 Stage Review

## 1. Executive Summary

```yaml
stage: AUT-2 Requirement Alignment + Baseline + Change Request
result: PASS_CANDIDATE
base_commit: 57390ff
implementation_commit: fe2bf56
v1_core_changed: NO
webgpt_v1_changed: NO
native_execution_started: NO
planner_started: NO
reviewer_started: NO
```

本阶段建立了需求对齐、Canonical Requirement、显式用户确认、Change Request / Impact Analysis、数据出站边界和 WebGPT REQUIREMENT 合同。没有进入 AUT-3，也没有执行 Planner/Reviewer/Native。

## 2. Requirement Alignment

- 批量问题：PASS。
- 阻塞问题要求用户回答：PASS。
- 非阻塞假设显式记录并绑定影响/置信度：PASS。
- 可用上下文与自动证据：PASS；无 provider 时 `WAITING_AUTOMATIC_EVIDENCE`，不伪造事实。
- Canonical Requirement 字段、bounded validation、hash：PASS。
- 用户确认和 stale hash fail-closed：PASS。
- Change Request、deterministic diff、impact analysis、旧版 supersede/new active：PASS。

## 3. WebGPT Boundary

`RequirementWebGptAdapter` 只通过已有 WebGPT Role Session / Request Manager 端口工作。它要求 Registry 中存在精确 BOUND REQUIREMENT binding，并检查 requestId、idempotencyKey、semanticSha256 和 target Chat。它不读取当前页面、不自动换 Chat、不创建替代 Thread/Chat、不改变 V1 Native Thread/Turn/Item 事实。

## 4. Persistence / Host

- Automation document schema 保持 v3，并增加 requirement alignment/change request collections。
- v2 JSON migration：PASS，创建 rollback backup，保留旧 IDs、hash、audit chain。
- v2 SQLite metadata migration：PASS，原地升级 document schema 到 3，创建 `.sqlite` backup，保留 durable identities/audit hash。
- 正常打包 GUI host smoke：PASS；Automation SQLite store 创建后关闭、重新打开并读回同一 project。
- 没有依赖 `ELECTRON_RUN_AS_NODE`。

## 5. Tests / Gate Evidence

```yaml
npm run check: PASS
npm test: PASS
tests: 276/276
npm run build: PASS
npm run package:win: PASS
npm audit --omit=dev: 0 vulnerabilities
git diff --check: PASS
secret scan: PASS (no concrete credential/token/cookie/private-key pattern in AUT-2 evidence)
```

正常 GUI store smoke 输出的关键值：`mode=normal-gui-host`、`created=true`、`reopened=true`、`documentSchemaVersion=3`、`writerAuthority=Workbench Automation Host`。

## 6. Real WebGPT

打包 EXE `webgpt status --json` 返回 `workbench=READY`、`webgpt=UNAVAILABLE`、`pageHealthy=false`。未提供可用的显式测试 Project/REQUIREMENT Chat，因此实际网页 Prompt 数量为 `0`，没有创建 Chat，也没有进行真实网页 response 验证。该限制已记录在 `docs/AUT-2-REAL-WEBGPT-EVIDENCE.md`，不伪造 Real PASS。

## 7. Data / Prompt Injection Boundary

只允许 bounded ContextItem；Project Content 是 `UNTRUSTED_PROJECT_CONTENT`。Cookie、Token、Secret、raw HTML、Transcript、private chat payload 不进入 outgoing request 或 Automation persistence。注入文本只作为不可信数据。

## 8. Scope Boundary / Limitations

Accepted for this stage：真实网页 WebGPT 因 runtime unavailable 未执行；repair 的网页真实触发未执行，但 bounded contract/unit 证据通过。

Not accepted as a success claim：真实 WebGPT round-trip、Planner continuation、Reviewer execution、Native execution、Automation workflow、multi-account/session、页面自动化 UI。

## 9. Files

实现：`src/automation/requirement-*.ts`、`src/automation/schema.ts`、`src/automation/sqlite-persistence.ts`、`src/automation/state-machine.ts`、`src/automation/store.ts`、`src/automation/types.ts`、`src/main/main.ts`。

测试：`tests/aut2-*.test.ts` 以及持久化/基础 schema regression。

探针：`scripts/aut2-normal-gui-store-smoke.mjs`、`scripts/aut2-real-webgpt-smoke.ts`。

## 10. Subagents

4 个独立审计/实现子代理已自然完成并返回：Requirement Domain/State Machine、WebGPT Contract、Data Egress、Change/Impact Audit。主 Agent 审核并整合了全部结果；Gate 前 `running_subagents=0`。不保留运行中的子代理。

## 11. Provenance / Legacy

- AUT-1.5 base: `57390ff`。
- AUT-2 implementation: `fe2bf56`。
- 本阶段未修改旧 donor `D:\办公\AI\Codex_Workbench`。
- `D:\办公\AI\Auto_Agent` 保持 clean，未作为产品目录修改。
- 用户未提交规划资料、`dist-stage-a/` 与 `指导文档/*.docx` 未加入本阶段 commit。

## 12. Gate

```yaml
requirement_alignment: PASS
batch_questions: PASS
canonical_requirement: PASS
explicit_user_confirmation: PASS
change_request: PASS
impact_analysis: PASS
webgpt_requirement_integration: PASS
data_egress: PASS
prompt_injection_boundary: PASS
normal_packaged_gui_store: PASS
real_webgpt_prompts: 0
native_execution_started: NO
planner_started: NO
reviewer_started: NO
v1_core_changed: NO
webgpt_v1_changed: NO
gate: READY_FOR_GPT_REVIEW
```

## 13. Package Provenance

```yaml
package: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
outerExeSha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
appMainSha256: 742FB46FC8F4C152D54133649C685D31F439C337D61B4F5F89C2D9C1BEB8E0E2
appRendererSha256: 94E053CB5726F14905580F2F917317DF89DA1A3913E41B0134BBAA935A723BA1
appPackageJsonSha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
```
