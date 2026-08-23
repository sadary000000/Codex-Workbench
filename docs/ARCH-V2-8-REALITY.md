# ARCH-V2-8 Reality — Final Manifest Reconciliation

## Current state

```yaml
stage: ARCH-V2-8
technicalGate: FAIL_WITH_EVIDENCE
status: GPT_REVIEW_REQUIRED_WITH_BLOCKERS
finalFrozen: false
implementationHead: 926440739ef3ca4a35a41f9d8b6537b31ac66d25
repositoryHeadAtRound2Start: 41467ceff78f7e59365233f4472c3e72d1355596
round1ReviewCommit: 41467ceff78f7e59365233f4472c3e72d1355596
v1FrozenCoreChanged: false
real_business_prompts: 0
new_business_chats: 0
AUT-2: PAUSED
AUT-3: PAUSED
```

`implementationHead` 是本轮已审查的最后产品实现提交。ROUND 2 只重建文档、Manifest 和审查包，不改变产品代码。用户最终确认前不写 `FINAL_FROZEN`，也不将 `finalFrozen` 写为 `true`。

## Version and provenance facts

- `codex --version`: `codex-cli 0.147.0`。
- Resolver verified binary SHA-256：`935A1911ED5564FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D`。
- 生产路径顺序：resolver-selected binary → provenance/hash → `initialize` → protocol/version/capability validation → READY。
- 曾观察到的 `Codex Desktop/0.148.0-alpha.9` 不在 0.147.0 verified allowlist 内，状态为 `UNSUPPORTED`，生产路径 fail-closed；本轮没有放宽 allowlist。
- 生成协议 schema 的摘要仍只保存 hash，不打包 Cookie、Token、profile 或私人页面内容。

## Capability reality

当前真实可声明的能力分类见 `ARCH-V2-8-CAPABILITY-MATRIX.md`。Round 2 独立审计发现 5 个当前 P1：严格 protocolVersion/requested experimentalApi 门禁未闭合、两个生产 App Server 直连路径绕过共享 initialize 校验、legacy Control Plane 路径绕过 per-command capability、Recovery Provider Port 没有生产 side-effect bridge/recover wiring、生产 migration identity 覆盖与断言不完整。因此当前 Gate 必须是 `FAIL_WITH_EVIDENCE`，不能写成最终 Freeze；未执行真实业务 Thread/Turn 的能力仍保持 `TEST_ONLY` 或 `PAUSED_NOT_EXECUTABLE`。

## Package facts

- 标准 `dist/package` 覆盖仍被用户正在运行的 EXE 文件锁阻塞，记录为 `LOCKED_WITH_EVIDENCE`，没有强杀进程。
- 本轮现场 `npm run build` 同样在清理标准 `dist/package` 资源时收到 `EPERM`，因此最终状态为 `LOCKED_WITH_EVIDENCE`；isolated package 已通过，未把锁定误报成编译失败或产品缺陷。
- 隔离 package：`D:\办公\AI\Codex_Workbench_V1\dist-stage-arch-v2-8-fix-round-1\package`，其 GUI 外壳 hash 与标准外壳一致。
- GUI outer SHA-256：`31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC`。
- isolated `main.js`：`E9388F0C46E4FB81C175EB2FAA98FA373E97649CFB51BD49926B5268D0936F82`。
- `renderer.js`：`400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB`。
- `package.json`：`1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F`。

## Smoke facts

- WEB-6.6 protocol smoke：PASS；initialize/status、version mismatch 和 unsupported capability 均按预期返回；fresh unauthenticated page 的 `webgpt` 为 `UNAVAILABLE`，符合 fail-closed。
- WEB-6.4 arbiter smoke：PASS；capacity=1、并发仲裁、`USER_CONTROL` 和释放回 `FREE` 均成立。
- `real_business_prompts=0`、`new_business_chats=0`；本轮不创建业务 Chat、不发送业务 Prompt。
- 原始 WEB-6.6/WEB-6.4 smoke JSON 属于既有 dirty 删除状态，本轮不擅自恢复；审查包包含摘要、脚本边界和 hash 证据，不声称 raw JSON 自包含重放。

## Resolved historical findings

ROUND 1 的 P0/P1 blocker 集合中，已被当前实现关闭的历史项（idle isolation、activeSummary live lease、Recovery Intent reattach/reconcile、migration fallback、stable identity/policy pin）只在历史证据中保留，并标记为 `HISTORICAL_RESOLVED`。Round 2 审计重新发现的生产门禁/桥接/迁移覆盖问题不属于该历史集合，计入当前 P1。

## Current P1 findings — FAIL_WITH_EVIDENCE

| ID | Finding | Evidence boundary |
|---|---|---|
| P1-01 | strict `protocolVersion` 与 requested `experimentalApi` enforcement 不完整 | initialize 允许缺失且未按期望值严格比较；requested capability 未形成统一生产拒绝门禁 |
| P1-02 | production `map-coordinator` / `project-map-manager` App Server 路径绕过 shared initialize validator | 两处 raw initialize bypass `validateInitializeResult` |
| P1-03 | legacy Control Plane path 绕过 per-command capability enforcement | modern path 有 gate，legacy compatibility path 可进入 handler |
| P1-04 | Recovery Provider Port production side-effect bridge/recover wiring 缺失 | Port/resolve ref 存在，但 production 未构造 `WebGptExternalActionBridge` 并执行 submit/recover |
| P1-05 | production migration identity coverage/assertion incomplete | migration contract 未覆盖 alignment sessions/rounds/questions/assumptions/change requests，调用点未执行 identity assertion |

这些问题本轮只记录证据并提交 GPT，不能自行修复或将其降级为 P2。普通 startup 的 `app_ready` logger 边界由审计提出，但在当前“无 Automation/WebGPT/SQLite side effect”范围下不计为新增 P0，交 GPT 定义边界。

## Current deferred debt

仍保留 3 个结构化 P2，见 `ARCH-V2-8-DEFERRED-DEBT.md`；它们均非阻塞，但不能抵消上述 P1。当前 `P0=0`、`P1=5`、`P2=3`。

## Safety boundary

没有读取 Cookie、Token、localStorage、浏览器 profile、生产数据库或私人 ChatGPT 内容；没有进入 AUT-2/AUT-3；没有创建替代 Conversation truth、Transcript truth、Task truth 或隐藏 Thread。
