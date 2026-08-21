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
