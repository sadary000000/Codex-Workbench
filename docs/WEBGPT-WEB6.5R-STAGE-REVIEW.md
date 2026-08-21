# WEB-6.5R Stage Review

```yaml
stage: WEB-6.5R Role Targeted Latest Final Closeout
result: BLOCKED
base_commit: ce7a50f99922525585fcba4d2c9fbd2d8a0bf06b
implementation_commit: 5e371b1
parallel_current_stage_subagents: 4
new_real_prompts: 0
v1_core_changed: NO
future_stage_planning_by_codex: NO
future_stage_preresearch_by_codex: NO
automation: NOT_STARTED
```

## Scope Resolution

本阶段只收口 Role Registry 到精确绑定 Chat 的定向 latest read。CLI、Control Plane、Browser Lease、目标导航、目标确认和 `--out` 都保持现有边界；不创建新 Chat，不发送 Prompt，不修改 V1 Frozen Core，不进入任何未来阶段。

## Root Cause / Current Finding

代码审计确认 `chat latest` 与 `role latest` 在目标导航后的读取阶段共用 `WebGptRequestManager.readLatestChat`。历史真实记录中的 Role mismatch 不能在当前环境直接复现为 Role-only 分流缺陷，因为本轮对现有三个绑定执行 `chat latest` 时全部先失败为 `WEBGPT_TARGET_CHAT_MISMATCH`；页面实际回到 ChatGPT 首页。系统因此正确 fail-closed。

本阶段修复了两个确定性身份规范问题：

- Role Chat URL 只允许严格路径，尾斜杠 canonicalization 后再做 collision/target 比较，重复斜杠直接拒绝。
- latest 结果和 Role send 等待观察均使用 Role canonical URL，不再用通用 URL 形式与 Role target 直接字符串比较。

没有通过忽略 mismatch、读取当前页面或静默 rebind 来“修复”证据。

## Files Changed

```text
src/features/webgpt/runtime/webgpt-role-session-registry.ts
src/features/webgpt/runtime/webgpt-request-manager.ts
src/features/webgpt/runtime/webgpt-workspace.ts
tests/webgpt-role-session-registry.test.ts
tests/webgpt-request-manager.test.ts
```

## Verification Summary

```text
npm run check                         PASS
npm test                              PASS 198/198
targeted Role/Request tests           PASS 16/16
npm audit --omit=dev                  PASS 0 vulnerabilities
git diff --check                      PASS
changed-source secret scan            PASS
temporary CODEX_WORKBENCH_DIST package PASS
standard dist/package refresh         BLOCKED: EPERM, running EXE lock
real new prompts                      0
```

## Real Gate Summary

| 项目 | 结果 |
|---|---|
| Existing `chat latest` reference | 当前环境 FAIL-CLOSED；三个既有 binding 均 mismatch |
| Temporary Role binding | 未建立；避免改变长期用户 binding |
| `role latest` | FAIL-CLOSED / `WEBGPT_TARGET_CHAT_MISMATCH` |
| `role latest --out` | 未获得合法正向 Gate；未留下 output |
| wrong-chat read | 0 observed |
| silent role rebind | NO observed |
| fallback current Chat | NO |
| new real prompts | 0 |

## Frozen Core / Legacy Audit

- V1 Frozen Core：NONE changed。
- WEB-6.6 Control Plane Protocol Baseline：未修改，已冻结基线继续有效。
- `D:\办公\AI\Codex_Workbench`：只读，未修改。
- `D:\办公\AI\Auto_Agent`：未修改。
- `指导文档/*.docx`、`dist-stage-a/` 和原有 dirty 文件：未纳入本阶段提交。

## Subagents

4 个当前阶段子代理均自然完成并在审查后关闭：调用链差异、URL 规范化、Binding 安全回归、Official CLI/WEB-6.6 回归。它们没有修改仓库、没有创建 Chat/Project、没有发送 Prompt。

## Review Decision

当前代码修复和自动化门禁通过，但真实正向 Gate 前置不成立，且标准打包文件被运行实例锁定。因此本阶段状态为 `BLOCKED`，不是 `PASS_CANDIDATE`。在获得可达且已完成的 Chat A、关闭占用标准 package 的运行实例后，才可只重跑本阶段 zero-prompt real Gate；不需要改变当前安全 fail-closed 设计。

```text
next_action: USER_SUBMIT_THIS_REVIEW_PACKAGE_TO_GPT
```

## 本轮审查整理与最小 CLI 补充（2026-08-21）

本轮没有宣称上面的 Role 正向 Gate 已通过；上一轮的真实阻塞仍然成立：

- 既有 Role binding 的目标 Chat 在真实页面导航后不可达，chat latest 统一返回
  WEBGPT_TARGET_CHAT_MISMATCH，系统保持 fail-closed。
- 没有发送新的真实 Prompt，也没有改变长期 Role binding。

同时根据用户补充的真实网页行为修正了 Project new-chat 的语义：

``` text
Project 行的铅笔
  → 打开目标 Project 的“新聊天”编辑器
  → 此时尚未 materialize /c/<chat-id>
  → 第一次 Prompt 才创建真实 Chat
```

因此当前 webgpt project new-chat --name <name> --json 在确认 Project
上下文和 Composer 后返回 chatUrl: null、chatCreated: false、
chatMaterialized: false、awaitingFirstPrompt: true，并明确
promptSent: false。它不再把 Project disclosure 或 Project 首页误报为已创建 Chat，
也不发送 Prompt。

为替代下一轮的 Windows 应用控制，新增官方 CLI：

``` text
Codex Workbench CLI.exe webgpt close --json
```

该命令通过现有 authenticated Control Plane 请求 Electron 正常退出，复用既有
before-quit 清理路径；不强杀进程、不点击窗口、不使用坐标控制。没有正在运行的
Workbench 时返回 WORKBENCH_NOT_RUNNING，不会为了 close 冷启动 GUI。

本轮自动验证已从上一版的 198/198 更新为 200/200；标准 dist/package
仍因当前运行中的旧版 Workbench 进程锁定而无法刷新，源码构建/打包已在独立临时
CODEX_WORKBENCH_DIST 下通过。故本轮结论仍为 BLOCKED，不能把临时包
冒充标准最终包。

随后已将临时包的最新应用资源和未被占用的 CLI/CLI Runtime 文件同步到标准
dist/package；正在运行的 GUI 外壳和被占用的 Electron DLL 没有覆盖。使用 Node
execFile 实际调用标准 CLI 的 close 命令时，当前旧进程返回
CONTROL_COMMAND_UNSUPPORTED；这是旧进程尚未加载本轮 close 路由的预期结果，命令
没有发送 Prompt，也没有强制关闭该旧进程。旧进程正常退出并重新打开标准 EXE 后，
再执行同一条 close 命令才是本轮新路由的 live smoke。
