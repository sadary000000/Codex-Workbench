# ARCH-V2-8 FIX ROUND 3 — Final P1 Closure Review

## 1. Gate summary

```yaml
stage: ARCH-V2-8 FIX ROUND 3
result: FIX_REQUIRED
base_commit: e9d9e1b0cc4ff16de92b35b6c2375f860b110c3e
implementation_commits:
  - f259a65 fix: close arch-v2-8 final p1 gaps
  - 2e799ab fix: fail closed on migration identity gaps
finalFrozen: false
AUT-2/AUT-3: PAUSED
P0: 0
P1_remaining: 2
P2: 3
real_business_prompts: 0
new_business_chats: 0
running_subagents: 0
```

本轮只处理 FIX-01～FIX-05，没有进入 FINAL_FROZEN，没有恢复 AUT-2/AUT-3，没有创建业务 Chat，也没有发送真实业务 Prompt。

`P1_remaining=2` 是真实 App Server ABI 证据型阻塞：当前解析到的 Codex 0.147.0 initialize 响应没有 `protocolVersion` 与 `capabilities`，因此严格生产 Gate 按设计拒绝进入 READY。它不是通过放宽验证器来隐藏的问题。

## 2. Scope and architecture boundary

本轮保留以下边界：

```text
Native Thread / Native Turn / Native Item
              ↓
        V1 Frozen Core
              ↓
 App Server / WebGPT / Control Plane extensions
              ↓
 strict bootstrap + provider recovery + migration identity checks
```

没有新增 Conversation、Transcript、Task、Context 或 Exec-history 第二事实源；没有替换 Native identity；没有实现 Automation、Planner、Reviewer、Workflow 或下一轮产品功能。

## 3. Fix matrix

| Fix | 实现 | 自动化证据 | 真实 Gate 结论 |
| --- | --- | --- | --- |
| FIX-01 strict initialize protocol/capability | `app-server-bootstrap.ts` 统一执行 start → initialize → exact protocolVersion → requested experimentalApi；失败返回 `VERSION_MISMATCH` / `CAPABILITY_NOT_SUPPORTED`，不会继续 thread/turn | strict fixture、负例、Host/Runtime 测试通过 | **FAIL_WITH_EVIDENCE**：真实 0.147 initialize 缺少必需字段，严格拒绝 READY |
| FIX-02 all production App Server paths | Native Thread、Shared Host、Map、Project Map 均走共享 bootstrap；生产进程构造启用 binary provenance 验证；`skipInitialize` 只接受 Host attestation | 生产源码审计、Host/Runtime/Map 契约测试通过 | **FAIL_WITH_EVIDENCE**：同一真实 ABI 缺字段，无法证明生产 valid runtime READY |
| FIX-03 legacy command capability | legacy 与 modern 均使用共享 `authorizeControlPlaneCommand` / 单一 capability registry；unsupported/version mismatch 在 handler 前返回 | legacy unsupported、initialize capability、supported command tests 通过 | **PASS** |
| FIX-04 recovery Provider Port / Bridge | 生产 composition materializes `WebGptExternalActionBridge` 与同一 RequestManager adapter；Provider Port 的 recover 先 classifier，再 observe/reconcile；terminal、未知 correlation、input ref 均 fail-closed | provider boundary、external-action、ARCH-V2-7 harness 与 composition contract 通过；second submit=0 | **PASS（isolated/contract evidence）**；未做真实业务 Prompt |
| FIX-05 migration full identity | 23 个持久化 collection 的 canonical identity 字段集中登记；migrate/recover 生产调用点执行 assertion；缺失、重复、漂移或无法比较均拒绝 | full identity、alignment/round/question/assumption/change-request、migration recovery tests 通过 | **PASS（isolated/contract evidence）** |

## 4. Real App Server initialization evidence

本轮只进行了无业务副作用的 initialize 探针：没有 `thread/start`、`thread/read`、`thread/resume`、`turn/start`，没有 Prompt。

```yaml
command_source: C:\Users\sadar\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe
observed_user_agent: Codex Desktop/0.147.0 (Windows 10.0.19045; x86_64) dumb (arch-v2-8-round3-init-smoke; 0.1.0)
raw_initialize_keys:
  - codexHome
  - platformFamily
  - platformOs
  - userAgent
protocolVersion: null
capability_keys: null
strict_result: VERSION_MISMATCH
thread_started: false
turn_started: false
prompt_sent: false
```

因此不能把当前实际运行时写成支持严格 protocol/capability Gate，也不能自动放宽到观察到的 Desktop `0.148.0-alpha.9`。

## 5. Changed files

### Production

```text
src/automation/migration-contract.ts
src/automation/migration-identity.ts
src/automation/sqlite-persistence.ts
src/codex/app-server-bootstrap.ts
src/codex/app-server-capabilities.ts
src/codex/app-server-client.ts
src/codex/app-server-host.ts
src/codex/app-server-protocol-contract.ts
src/codex/native-thread-runtime.ts
src/main/main.ts
src/main/map-coordinator.ts
src/main/project-map-manager.ts
src/main/webgpt-control.ts
src/shared/webgpt-control-plane-contract.ts
```

### Tests

```text
tests/app-server-capabilities.test.ts
tests/app-server-host.test.ts
tests/arch-v2-8-fix-round-1-d.test.ts
tests/arch-v2-8-fix-round-3.test.ts
tests/fixtures/fake-app-server.mjs
tests/native-thread-runtime.test.ts
tests/webgpt-control-plane-baseline.test.ts
```

## 6. Verification

```yaml
npm_run_check: PASS
npm_test: 392/392 PASS
targeted_round3_contract: 6/6 PASS
arch_v2_1_to_7_selected_regression: 67/67 PASS
arch_v2_2_protocol_generation: PASS
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS_WITH_NORMAL_LF_CRLF_WARNINGS
scoped_secret_scan: PASS
isolated_build: PASS
isolated_package: PASS
standard_build: LOCKED_WITH_EVIDENCE (EPERM on dist/package/Codex Workbench V1.exe)
standard_package: LOCKED_WITH_EVIDENCE (not overwritten; active user process preserved)
real_business_prompts: 0
new_business_chats: 0
```

Selected ARCH-V2-1～7 regression command:

```text
node --experimental-strip-types --test tests/automation-foundation.test.ts tests/automation-persistence.test.ts tests/arch-v2-4-fix-round-1.test.ts tests/arch-v2-4-external-action.test.ts tests/arch-v2-5-policy.test.ts tests/arch-v2-5-production-consumers.test.ts tests/arch-v2-6-provider-boundary.test.ts tests/arch-v2-6-evidence-correlation.test.ts
```

该命令结果为 67/67 PASS。它只使用隔离 fixture/临时数据，不发送真实业务 Prompt。

## 7. Isolated package provenance

```yaml
path: D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-8-fix-round-3\package
outer_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_exe_sha256: 83E587125CC5EF609E1A8B52B414EAAC22E8362EB973BC01F226DF0EC3E46BC7
main_js_sha256: 3EB53C61973D82863A92D1FFBF035EDE7BA2C2E25CC61D019849BAD71416FF93
renderer_js_sha256: 400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
control_plane_schema_sha256: 0E13F0B1D6A1A9AF37DFEEE13FEFEBE70F532BB5C6F75C29AD7860C2B7A72E59
```

标准 `dist/package` 没有被覆盖；锁定原因记录为证据，不强杀用户进程。

## 8. Subagents

6 个独立只读子代理已自然完成、结果经主 Agent 审核并整合后关闭：

```yaml
A: FIX-01 initialize/protocol/provenance — completed, adopted
B: FIX-02 Map/Project Map shared gate — completed, adopted
C: FIX-03 legacy capability — completed, adopted
D: FIX-04 recovery production wiring — completed, adopted as bounded composition/recovery evidence
E: FIX-05 migration identity — completed, adopted
F: independent final challenge — completed, integrated findings
started: 6
completed: 6
running_at_gate: 0
real_prompts_by_subagents: 0
```

## 9. P2 deferred debt

保持不变，均不进入 executable production path：

```text
P2-01 无完整 user-facing production projection rebuild command
P2-02 无 user-facing migration command
P2-03 legacy URL-shaped TEST_ONLY / LEGACY_READ_ONLY seam
```

## 10. Protection and privacy

- `D:\办公\AI\Codex_Workbench` 未修改。
- `D:\办公\AI\Auto_Agent` 未修改。
- 用户已有 dirty/untracked 文件、历史 dist-stage、`docs.zip`、指导文档未清理、覆盖或自动纳入本轮提交。
- 审查包不包含 Cookie、Token、Password、Browser profile、私人 Chat、raw business Prompt、production DB 或完整 production Journal。

## 11. GPT review gate

```text
[ARCH_V2_8_FIX_ROUND_3_REVIEW_READY]

stage: ARCH-V2-8 FIX ROUND 3
finalFrozen: false
AUT-2/AUT-3: PAUSED

fix_01_strict_protocol_capability: FAIL_WITH_EVIDENCE
fix_02_all_appserver_paths_shared_gate: FAIL_WITH_EVIDENCE
fix_03_legacy_controlplane_command_gate: PASS
fix_04_recovery_production_wiring: PASS
fix_05_migration_full_identity: PASS

P0=0
P1=2
P2=3
tests=PASS
regressions=PASS
real_business_prompts=0
new_business_chats=0

subagents_started=6
subagents_completed=6
running_subagents=0

requested_gate: FIX_REQUIRED
```

本轮不自行设计下一轮修复，等待 GPT 对真实 ABI 缺字段与严格生产 Gate 的审查结论。
