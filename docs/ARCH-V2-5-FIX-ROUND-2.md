# ARCH-V2-5 FIX ROUND 2

```yaml
stage: ARCH-V2-5 FIX ROUND 2
base_commit: e09b80a
implementation_commit: d445fb5
previous_gate: FIX_REQUIRED
v1_core_changed: NO
aut2_aut3_restored: NO
real_business_prompts: 0
gate: READY_FOR_GPT_REVIEW
```

本轮只处理 GPT 审查指出的两个门禁问题：默认测试发现边界，以及 packaged
WEB-6.6 `webgpt.status` 的启动/CLI smoke。没有重做 Policy Authority、预算
消费者、Reservation、Runtime Registry 或任何 Automation 产品层。

## GPT findings addressed

上一轮 GPT Gate 为 `FIX_REQUIRED`：

1. `npm test` 无边界地收集用户保留的历史 `dist-stage-arch-v2-5/review-staging`
   测试副本，导致缺少其配套 `canonical.ts` 的导入失败；
2. WEB-6.6 packaged status 子进程退出或无 JSON，需闭合启动/readiness/CLI
   路径并给出有界确定性结果；
3. P2 policy-version governance 文档项不是本轮阻塞项，保持为文档后续项。

## Fix 01 — test discovery boundary

`package.json` 的 `test` 与 `test:unit` 现在显式限定为：

```text
node --experimental-strip-types --test "tests/**/*.test.ts"
```

这样只发现产品源代码的正式 `tests/` 树，不把 `dist-stage-*`、review package
或用户保留的历史 staging 当作产品测试入口。历史 staging 未删除、未覆盖、未
修改；本轮只是修正默认 test discovery 的边界。

## Fix 02 — packaged status readiness and CLI smoke

### 根因

`src/main/main.ts` 中 `AUT2_NORMAL_GUI_STORE_SMOKE` 的分支条件曾被反转：正常
启动也进入一次性 store smoke 并最终 `app.quit()`，导致 packaged Workbench 在
Control Plane descriptor 可用前退出。修复后：

```text
normal startup
  -> ensureWebGptRuntimePolicy
  -> keep AutomationStore open
  -> start WebGPT Control Plane

AUT2_NORMAL_GUI_STORE_SMOKE=1
  -> run only the explicit smoke
  -> retain its existing smoke lifecycle
```

### Smoke 边界

`scripts/real-webgpt-web6.6-protocol-smoke.ts` 现在：

- 使用隔离临时 userData 启动本轮 packaged `Codex Workbench V1.exe`；
- 等待真实 descriptor/readiness，而不是固定 sleep；
- 通过同一 Windows Named Pipe 做 `webgpt.initialize → webgpt.status`；
- 通过打包内 `Codex Workbench CLI Runtime.exe`、`--workbench-official-cli`
  和同一临时 `--user-data-dir` 再执行一次官方 CLI ABI 的 `webgpt status --json`；
- 验证 `exitCode=0`、`command=webgpt.status`、`ok=true`，否则失败并保留脱敏
  错误；
- 继续执行 `VERSION_MISMATCH` 和 `CAPABILITY_NOT_SUPPORTED` fixtures；
- 只记录 bounded diagnostics，不记录 authToken 值、Cookie、Token、profile、
  Prompt 或用户聊天内容。

直接 Control Plane 与 packaged CLI Runtime 的最终结果均为：

```yaml
workbench: READY
webgpt: UNAVAILABLE
newRealPrompts: 0
```

`webgpt: UNAVAILABLE` 是隔离 smoke 没有登录/活动 WebGPT 页面时的真实业务状态，
不是 Control Plane 失败。`VERSION_MISMATCH` 和
`CAPABILITY_NOT_SUPPORTED` 仍按预期返回结构化错误。

### 中间诊断（不计为最终失败）

曾用 GUI EXE 冒充官方 CLI 启动，复现了旧的退出码/无 JSON；随后改用正式打包的
CLI Runtime 并在同一临时 userData 下重跑，最终通过。另一次使用官方 CLI wrapper
连接临时 host 时得到有界 `TIMEOUT`，原因是 wrapper 默认读取标准 userData，
而临时 host 使用隔离 userData；没有把该结果冒充为 PASS，也没有触碰用户默认
会话。最终 Gate 证据使用正确的 packaged CLI Runtime + 同 descriptor 路径。

## Verification

```yaml
npm_run_check: PASS
npm_test: 336/336 PASS
arch_v2_4_arch_v2_5_control_plane_targeted: 10/10 PASS
npm_run_build: PASS (isolated dist-stage-arch-v2-5-fix-round-2)
npm_run_package_win: PASS (isolated package)
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS
scoped_secret_scan: PASS
web6_6_packaged_protocol_smoke: PASS
web6_6_direct_status: exitCode=0, ok=true
web6_6_official_cli_runtime_status: exitCode=0, ok=true
version_mismatch_fixture: PASS
unsupported_capability_fixture: PASS
real_business_prompts: 0
```

最终 evidence：

```text
dist-stage-arch-v2-5-fix-round-2/review/WEBGPT-WEB6.6-REAL-GATE.json
```

## Regression and scope

- ARCH-V2-1/2/3/4 boundary evidence remains unchanged and source suite remains
  green；ARCH-V2-4/5/Control Plane targeted run is 10/10。
- `Native Thread/Turn/Item`、V1 Conversation truth、Runtime Registry、WebGPT
  页面逻辑、Request Manager 业务语义和 AUT-2/AUT-3 均未重做或恢复。
- 只修改了 normal packaged startup 的分支错误、测试发现边界和 WEB-6.6
  protocol smoke harness；没有发送真实网页 Prompt。
- 标准 `dist/package` 未强制覆盖，隔离构建目录用于本轮可复现证据；运行中的
  用户 Workbench 未被关闭。

## Subagents and protected inputs

本轮没有新增子代理。上一轮 GPT 要求的 Boyle、Faraday、Carver、Noether、Popper
五个子代理均已自然完成、结果已审核并关闭，`running_subagents=0`。本轮没有
后台子代理。

用户已有 `dist-stage-*`、`docs.zip`、导航/指导文档及其它 dirty baseline 未被
清理、reset、stash 或覆盖；旧 donor `D:\办公\AI\Codex_Workbench` 与
`D:\办公\AI\Auto_Agent` 保持只读/原状。

## Review gate

```text
[ARCH_V2_5_FIX_ROUND_2_REVIEW_READY]
stage: ARCH-V2-5 FIX ROUND 2
implementation_commit: d445fb5
test_discovery_boundary: PASS
packaged_status: PASS
official_cli_runtime_status: PASS
new_real_prompts: 0
v1_core_changed: NO
aut2_aut3_activated: NO
next_action: USER_SUBMIT_REVIEW_TO_GPT
```
