# ARCH-V2-8 FIX ROUND 4 — ABI-Native Compatibility Gate Review

## Stage review

```yaml
stage: ARCH-V2-8 FIX ROUND 4
result: PASS_CANDIDATE
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
base_commit: 80ca088
implementation_commit: fe30b94e090ea2bfd2b2ef78b700bf81d72e5db3
finalFrozen: false
AUT-2/AUT-3: PAUSED
P0: 0
P1: 0
P2: 3
real_business_prompts: 0
new_business_chats: 0
subagents_started: 4
subagents_completed: 4
running_subagents: 0
requested_gate: PASS
```

本轮只闭环 ABI-native compatibility gate。没有进入最终冻结，没有恢复 AUT-2/AUT-3，没有创建业务 Chat，也没有发送真实业务 Prompt。

GPT 对 Round 4 技术实现的复审结论为 PASS；随后提出的唯一 P1 是最终冻结前的可审计文档/Manifest 产物不完整。本次补充仅生成最终 Baseline、Capability Matrix、Frozen Contract Check、Compatibility Regression、Deferred Debt 和 Final Freeze Manifest，不修改产品代码。

## Executive summary

Round 3 的两个 P1 阻塞来自对 `initialize` 响应 ABI 的错误假设：实际 Codex App Server 0.147.0 的 `InitializeResponse` 只有 `codexHome`、`platformFamily`、`platformOs`、`userAgent` 四个 verified fields；`protocolVersion` 和响应侧 `capabilities` 不属于当前 verified response schema。`experimentalApi` 属于 Workbench 发出的 initialize request capability，而不是必须从 response 回读的字段。

Round 4 将 Gate 改为 ABI-native：

- response 严格校验当前生成 schema 的四个必需字段；
- request 明确发送并校验 `clientInfo` 与 `capabilities.experimentalApi`；
- binary provenance 与 generated-schema provenance 在 initialize 前 fail closed；
- version parser 拒绝 prerelease/未来版本的边界误匹配；
- Native Thread、Shared Host、Map、Project Map 的生产路径继续使用共享 bootstrap；
- operation capability registry 保持 unsupported operation fail closed；
- 负向 Gate 在 binary/schema/request 不满足时不启动 Thread、Turn 或 Prompt。

## Scope and architecture boundary

### In scope

1. 纠正 Codex App Server 0.147.0 `InitializeResponse` 的 verified ABI。
2. 固化同一 Codex binary 生成的 TypeScript/JSON schema provenance。
3. 保留 initialize request 的 `clientInfo` 和 `capabilities.experimentalApi`。
4. 更新 client/host/native runtime attestation。
5. 为 binary、schema、request、version 和 side-effect boundary 增加 contract/negative tests。

### Out of scope

- 不升级或引入 Codex 0.148 alpha ABI。
- 不把旧的 response `protocolVersion` / `capabilities` 要求保留为生产必需条件。
- 不重做 RuntimeRegistry、Native Thread、Project Map、WebGPT 或 Control Plane 架构。
- 不实现 Automation、Planner、Reviewer、Workflow 或 AUT-2/AUT-3。
- 不发送真实业务 Prompt，不创建业务 Chat。

### Frozen truth boundary

```text
Native Thread / Native Turn / Native Item
              ↓
        V1 Frozen Core
              ↓
 App Server compatibility bootstrap / attestation
              ↓
 Native / Shared Host / Map / Project Map consumers
```

本轮只修改 Core-adjacent App Server compatibility bootstrap/attestation；没有改变 Native identity、消息事实、运行事实或项目归属事实，也没有新增 Conversation、Transcript、Task、Context 或 Exec-history 第二事实源。

## Root cause and compatibility decision

### Observed runtime fact

真实 resolver binary 为 Codex 0.147.0。无副作用 initialize probe 的 response keys 为：

```text
codexHome, platformFamily, platformOs, userAgent
```

因此 Round 3 的严格 response check 把不存在的 response fields 当成协议必需项，造成 `VERSION_MISMATCH` / `CAPABILITY_NOT_SUPPORTED`，而不是 Codex 0.147.0 本身不能 initialize。

### Round 4 decision

```text
Initialize request:
  clientInfo
  capabilities.experimentalApi

Initialize response:
  codexHome
  platformFamily
  platformOs
  userAgent
```

旧字段如果作为额外字段出现可以被忽略，但不再被要求；未知/混合 schema、错误 binary、错误 version、错误 request capability 仍然 fail closed。

## Reality / Capability Matrix

| Gate / fact | Evidence | Result |
| --- | --- | --- |
| Codex binary resolution | Actual resolver path and SHA-256 recorded in contract | PASS |
| Stable binary version | `codex-cli 0.147.0`, exact stable boundary parser | PASS |
| InitializeResponse ABI | Four required generated-schema fields | PASS |
| Request `clientInfo` | Explicit name/version request validation | PASS |
| Request `capabilities.experimentalApi` | Explicit boolean, expected value checked | PASS |
| Generated schema provenance | TypeScript/JSON provenance and per-schema hashes checked | PASS |
| Server identity attestation | `userAgent` version and binary provenance must agree | PASS |
| Unsupported operation handling | Existing operation capability registry remains fail closed | PASS |
| Native production bootstrap | Shared bootstrap and host attestation audit | PASS |
| Shared Host production bootstrap | Shared bootstrap and schema/binary attestation | PASS |
| Map / Project Map production bootstrap | Shared bootstrap source audit | PASS |
| Old response-field requirement | Removed as a required response condition | PASS |
| Negative side-effect boundary | No thread/turn/prompt on invalid gate | PASS |

## Frozen Contract Check

| Invariant | Round 4 result |
| --- | --- |
| Native Thread remains the only conversation identity | Preserved |
| Native Turn / Native Item remain message and run facts | Preserved |
| Codex App Server remains the runtime main path | Preserved |
| No second Conversation truth | Not introduced |
| No second Transcript truth | Not introduced |
| No hidden replacement Thread | Not introduced |
| No exec-history reconstruction | Not introduced |
| No business prompt/chat | 0 / 0 |
| `finalFrozen` | `false` |

## Implementation

### Protocol contract and schema provenance

`src/codex/app-server-protocol-contract.ts` now records:

- verified Codex binary version and SHA-256;
- generated TypeScript schema provenance;
- generated JSON schema provenance;
- `InitializeResponse` required fields and per-schema SHA-256;
- `InitializeParams` required `clientInfo` and per-schema SHA-256;
- an assertion that a candidate schema provenance must equal the verified contract.

The generated schema is treated as a checked-in provenance fact, not as an unverified runtime loader. A changed or mixed schema fails before initialize.

### ABI-native validation

`src/codex/app-server-capabilities.ts` now:

- validates only the four verified response fields;
- validates explicit request `clientInfo` and `capabilities.experimentalApi`;
- rejects missing/invalid fields and mismatched requested capability;
- rejects prerelease or future versions at the stable boundary;
- exposes schema and binary attestation instead of requiring nonexistent response fields;
- tolerates extra legacy response fields without making them part of the ABI contract.

`src/codex/app-server-bootstrap.ts` validates the request before sending it, sends the exact request contract, validates the response, and only then emits `initialized`.

### Production paths and attestation

`app-server-client.ts`, `app-server-host.ts`, and `native-thread-runtime.ts` now carry the verified schema/binary/request attestation. `skipInitialize` accepts only a Host-owned client with verified binary/schema provenance and `experimentalApi=false`.

The Round 4 source audit confirms Native Thread, Shared Host, Map, and Project Map paths continue to use the shared bootstrap. No alternate production initializer was introduced.

### Changed files

Production and tests changed in implementation commit `fe30b94`:

```text
src/codex/app-server-protocol-contract.ts
src/codex/app-server-capabilities.ts
src/codex/app-server-bootstrap.ts
src/codex/app-server-client.ts
src/codex/app-server-host.ts
src/codex/native-thread-runtime.ts
tests/app-server-capabilities.test.ts
tests/arch-v2-8-fix-round-4.test.ts
tests/app-server-host.test.ts
tests/fixtures/fake-app-server.mjs
tests/native-thread-runtime.test.ts
```

## Compatibility Regression

The following Round 3 regression is closed:

```text
Round 3 strict response check required protocolVersion/capabilities.
Actual Codex 0.147.0 response omitted both.
Round 4 accepts the verified ABI and keeps fail-closed provenance/version checks.
```

The following remain covered:

- unsupported capability/operation fail closed;
- wrong binary path or hash fails before process use;
- schema provenance mismatch fails before initialize;
- request capability mismatch fails before initialize;
- response missing any of the four verified fields fails;
- prerelease/future version does not pass stable 0.147.0 validation;
- Native/Host/Map/Project Map shared bootstrap source audit;
- no Thread/Turn/Prompt on negative gate.

## Real no-side-effect App Server probe

This was an initialize-only probe through the actual resolver and `startAndInitializeAppServerClient` path. The probe did not call `thread/start`, `thread/read`, `thread/resume`, or `turn/start`.

```yaml
binary_sha256: 935A1911ED2556E4FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D
observed_user_agent: Codex Desktop/0.147.0 (Windows 10.0.19045; x86_64) dumb (codex-workbench-v1-arch-v2-8-round4-init-probe; 0.1.0)
response_keys:
  - userAgent
  - codexHome
  - platformFamily
  - platformOs
schemaProvenanceVerified: true
requestedExperimentalApi: false
notifications_observed:
  - remoteControl/status/changed
error: null
process_exit_code: 0
thread_started: false
turn_started: false
prompt_sent: false
business_chat_created: false
```

The temporary `codexHome` path is intentionally omitted from the report; it is not needed to prove the ABI and could expose machine-specific noise.

## Test Summary

| Command / evidence | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm test` | PASS, 400/400 |
| Round 4 + App Server capability/host/runtime targeted tests | PASS, 11/11 |
| `npm run test:protocol:arch-v2-2` | PASS; generated TS 642, JSON schema 285, repeatable |
| `npm audit --omit=dev` | PASS; 0 vulnerabilities |
| `git diff --check` | PASS; only normal line-ending warnings |
| scoped secret scan | PASS |
| isolated `npm run build` | PASS |
| isolated `npm run package:win` | PASS |
| real App Server initialize probe | PASS; no business side effects |

The standard `dist/package` was not overwritten because the known running EXE lock was preserved. The isolated build/package output is the Round 4 package provenance source.

## Isolated package provenance

```yaml
package_root: D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-8-fix-round-4\package
outer_exe_sha256: 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
cli_exe_sha256: 9438EEC0E05BECC5B9221E4D8B5E4DA1256AF3CA7510FECBF02C505CC89C00FE
main_js_sha256: 3EB53C61973D82863A92D1FFBF035EDE7BA2C2E25CC61D019849BAD71416FF93
renderer_js_sha256: 400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB
package_json_sha256: 1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F
control_plane_schema_sha256: 0E13F0B1D6A1A9AF37DFEEE13FEFEBE70F532BB5C6F75C29AD7860C2B7A72E59
binary_contract_sha256: 935A1911ED2556E4FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D
```

The Electron outer EXE is a fixed shell. Application provenance is verified through packaged resources and the binary contract.

## Deferred debt

P2 debt remains intentionally deferred and is not in the executable production path:

```text
P2-01: no complete user-facing production projection rebuild command
P2-02: no user-facing migration command
P2-03: legacy URL-shaped TEST_ONLY / LEGACY_READ_ONLY seam
```

No new debt was introduced by Round 4. AUT-2/AUT-3 remain paused.

## Final Baseline / Freeze Manifest

```yaml
implementation_commit: fe30b94e090ea2bfd2b2ef78b700bf81d72e5db3
finalFrozen: false
technicalGate: READY_FOR_FINAL_HUMAN_FREEZE
next_stage: not_started
AUT-2: PAUSED
AUT-3: PAUSED
business_prompts: 0
business_chats: 0
review_package: D:\办公\AI\Codex_Workbench_V1\dist\review\ARCH-V2-8-REVIEW-PACKAGE.zip
review_package_sha256: adjacent .sha256 sidecar generated after packaging
```

## Final freeze artifacts reconciliation

```yaml
final_baseline: docs/ARCHITECTURE-BASELINE-V2-FINAL.md
final_manifest: docs/ARCH-V2-8-FINAL-FREEZE-MANIFEST.json
capability_matrix: docs/ARCH-V2-8-CAPABILITY-MATRIX.md
frozen_contract_check: docs/ARCH-V2-8-FROZEN-CONTRACT-CHECK.md
compatibility_regression: docs/ARCH-V2-8-COMPATIBILITY-REGRESSION.md
deferred_debt: docs/ARCH-V2-8-DEFERRED-DEBT.md
final_manifest_sha256: adjacent ARCH-V2-8-FINAL-FREEZE-MANIFEST.sha256 sidecar
review_package_sha256: adjacent ARCH-V2-8-REVIEW-PACKAGE.zip.sha256 sidecar
consistency_check: PASS
product_code_changed: NO
finalFrozen: false
```

The final artifacts use the same implementation commit, test counts, gate counts, capability status, side-effect counts, and paused automation state. `HISTORICAL_RESOLVED` is used only for the Round 3 obsolete response-field assumption.

## Privacy and protected repositories

- No Cookie, Token, Password, browser profile, private chat, production database, or complete production journal is in the review package.
- `D:\办公\AI\Codex_Workbench` remains read-only and its pre-existing dirty baseline is preserved.
- `D:\办公\AI\Auto_Agent` remains unchanged.
- User-owned dirty/untracked files, `docs.zip`, guidance documents, and historical `dist-stage-*` directories are not staged by this Round 4 commit.
- Four Round 4 subagents were read-only and produced no prompts, chats, or file writes.

## GPT review request

```text
[ARCH_V2_8_FIX_ROUND_4_REVIEW_READY]

stage: ARCH-V2-8 FIX ROUND 4
abi_native_initialize_gate: PASS
binary_provenance: PASS
schema_provenance: PASS
experimental_api_request_contract: PASS
all_production_appserver_paths: PASS_WITH_EVIDENCE
command_capability_regression: PASS
P0=0
P1=0
P2=3
tests=PASS
regressions=PASS
real_business_prompts=0
new_business_chats=0
finalFrozen=false
subagents_started=4
subagents_completed=4
running_subagents=0
requested_gate: PASS
```

Per the stage instruction, this is a candidate for final human freeze review only. Round 4 does not perform the freeze itself.
