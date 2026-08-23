# ARCH-V2-8 FIX ROUND 1 — Final Freeze Blocker Closure

## Review status

```yaml
stage: ARCH-V2-8 FIX ROUND 1
result: READY_FOR_GPT_REVIEW
base_commit: 99c0dcc151095c976a02144e6dc14ca3d2774ffd
implementation_commits:
  - 86e5569 fix: close arch-v2-8 freeze blockers
  - 3637c47 fix: explicitly activate control plane from cli
  - 5eab521 fix: propagate cli control activation to smoke hosts
  - 9264407 test: align cli host contract with explicit control startup
final_head: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
v1_frozen_core_changed: NO
automation_business_gate_started: NO
real_prompt_count: 0
new_chat_count: 0
running_subagents_at_gate: 0
```

本轮没有创建业务 Chat、没有发送真实业务 Prompt、没有读取 Cookie/Token/私人页面内容，也没有进入 AUT 或下一阶段的业务 Gate。

## Scope resolution

本轮只闭环 ARCH-V2-8 FIX ROUND 1 的 FIX-01～FIX-07：启动惰性隔离、App Server provenance/握手/能力门禁、activeSummary 事实边界、Recovery Intent 生产接线、迁移候选回退、稳定 identity/policy pin 校验。P2 的 projection rebuild、用户迁移命令和 legacy URL seam 仍 deferred。

## Fix matrix

| Fix | 实现与证据 | 结果 |
|---|---|---|
| FIX-01 P0 | 普通 GUI 启动不创建 Automation store/provider/workspace/control-plane；显式 WebGPT/CLI 才启动控制面；`tests/arch-v2-8-startup-idle.test.ts` 做高保真临时目录前后快照。CLI host 通过 `--webgpt-control` 显式激活。 | PASS |
| FIX-02 P1 | 生产 App Server 路径解析 packaged/PATH provenance、校验 binary hash、initialize handshake、协议/版本/能力；`skipInitialize` 仅允许已初始化测试 client；不扩大 0.147 allowlist。 | PASS |
| FIX-03 P1 | `COMMAND_REQUIRED_CAPABILITY` 与 Control Plane authorize 门禁统一映射；未协商能力返回 `CAPABILITY_NOT_SUPPORTED`，不进入 handler。 | PASS |
| FIX-04 P1 | `activeSummary()` 只投影 live OperationArbiter lease；历史/恢复状态不伪装成 ACTIVE/BUSY。 | PASS |
| FIX-05 P1 | Provider Port 接入 Recovery Intent；已有 ProviderRequest + UNKNOWN 只 reattach/reconcile，不新建 submit；terminal 与 input ref 均 fail-closed。 | PASS |
| FIX-06 P1 | migration candidates 按 newest-first 检查，最新损坏时回退到较旧有效候选；全部损坏则保留证据并 fail-closed。 | PASS |
| FIX-07 P1 | migration/provider/store 统一使用稳定 identity、ProviderRequest/ExternalRef correlation 与 policy pin 校验；版本/目标/policy 替换均 fail-closed，不 fallback latest。 | PASS |

## Production boundary

```text
Native Thread / Native Turn / Native Item
              ↓
        V1 Frozen Core
              ↓
  WebGPT / Control Plane extension
              ↓
  lazy persistence + provider-neutral recovery boundary
```

没有新增第二套 Conversation/Transcript/Task/Context truth，也没有替换 Native identity。现有 automation persistence 仅在显式 gate 或需要的 Control Plane 命令路径惰性初始化。

## Automated verification

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 389/389 |
| `npm run build` | 标准 `dist` 受正在运行的标准 EXE 锁定，`EPERM unlink dist/package/Codex Workbench V1.exe`；未强杀用户进程 |
| `CODEX_WORKBENCH_DIST=dist-stage-arch-v2-8-fix-round-1 npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS（仅换行符提示，无 whitespace error） |
| scoped secret scan | PASS — 未发现高风险 credential signature |

标准 package 阻塞是用户当前运行实例造成的文件锁，不是编译/打包错误。隔离 package 已使用同一实现提交重新生成并验证；标准目录待用户关闭运行实例后可安全更新。

## Real App Server / packaged smoke

### WEB-6.6 protocol smoke — PASS

- 使用隔离 `dist-stage-arch-v2-8-fix-round-1/package` 与临时 user-data。
- `newRealPrompts: 0`。
- packaged Control Plane initialize + `webgpt.status`: PASS。
- fresh unauthenticated page: `workbench=READY`, `webgpt=UNAVAILABLE`，符合 fail-closed 预期。
- protocol mismatch: `VERSION_MISMATCH`。
- unsupported requested capability: `CAPABILITY_NOT_SUPPORTED`。
- evidence 未写入 authToken，仅记录 `authTokenCaptured: true / authTokenWrittenToEvidence: false`。

### WEB-6.4 arbiter smoke — PASS

- 使用隔离 package 与临时 user-data。
- `maxRealPrompts: 0`、`realPromptCount: 0`、`concurrentCliCount: 2`。
- capacity=1、并发操作被仲裁；USER_CONTROL 下自动操作返回 `USER_CONTROL`；队列释放回 `FREE`。
- 未打开全局 New Chat、未创建 Chat、未读取私人页面内容。

### ARCH-V2-1～7 regression boundary

本轮 `npm test` 的 389 个 contract/unit/integration tests 全量通过，覆盖既有 ARCH-V2-1～7 的 persistence、identity、recovery、arbiter、provider boundary 与 composition boundary。会发送 Prompt 或创建 Native Thread 的旧 real smoke 未在本轮运行，因为当前 FIX 指令明确禁止真实业务 Prompt/Chat；这不是把未运行项冒充 PASS。

## Subagents

5 个独立子代理均已自然完成并返回，主 Agent 审核后整合，随后关闭；Gate 时为 0：

| 子代理 | 任务 | 结果 |
|---|---|---|
| Schrodinger | FIX-01 idle startup | lazy startup 与 idle filesystem gate 采用 |
| Mendel | FIX-02/03 App Server provenance/capability | handshake、hash、capability gate 采用；修正报告中的 baseline hash typo |
| Boyle | FIX-04/05 live summary/recovery | live lease summary 与 Recovery Intent provider path 采用 |
| Helmholtz | FIX-06/07 migration/identity | newest→older migration fallback、stable identity/policy pin 采用 |
| Wegener | independent challenge | 发现 B/D 集成前的风险；经主线整合后已由 FIX-02/03/06/07 关闭 |

## Deferred / known limitations

- P2 projection rebuild、用户迁移命令、legacy URL seam 仍 deferred，不在本轮扩大。
- 标准 `dist/package` 当前不能覆盖更新，原因是用户进程持有 EXE 文件锁；隔离 package 已通过。
- 未运行会创建 Chat 或发送 Prompt 的旧 real smoke；遵循本轮零业务 Prompt/Chat 约束。
- 不做 FINAL_FROZEN、不进入 AUT、不开始下一阶段。

## Workspace protection

- 旧 donor `D:\办公\AI\Codex_Workbench`：保持原有 dirty baseline，未修改、未 reset/clean/stash/commit。
- `D:\办公\AI\Auto_Agent`：只读检查保持 clean。
- 其他历史 dist-stage、docs、docx 与 dirty 文件未被清理、覆盖或纳入本轮提交。

## Gate

```text
[ARCH_V2_8_FIX_ROUND_1_REVIEW_READY]
```
