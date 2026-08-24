# WEB-REVIEW-SUBMIT-1 阶段审查报告

## Executive Summary

```yaml
stage: WEB-REVIEW-SUBMIT-1
capability: Workbench WebGPT Review Submission
result: PASS_CANDIDATE_WITH_REAL_SMOKE_BOUNDARY
v1_frozen_core_changed: NO
second_browser_session: NO
automation_changed: NO
```

本阶段已把 Review ZIP + 摘要的一次性 CLI 提交能力接入 Workbench 的既有 WebGPT 路径。接口、幂等、失败恢复和自动化回归已完成；独立 Runner 的真实网页基线已完成。Workbench 正向网页 smoke 仍必须在 Workbench 自身已登录 WebGPT 会话中执行，不能由其他浏览器会话代替。

本轮新增的 packaged lifecycle smoke 使用隔离、未登录的 user-data-dir：已启动 Workbench 实例下 CLI 在约 304 ms 返回 `CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL`，没有发送 Prompt；因此它证明了单次调用和退出链路，不证明正向 `SENT`。冷启动隔离 smoke 在 30 秒观察窗口内未得到可用 Control Plane 响应，已停止并记录为启动边界，不把它写成成功。

```yaml
base_commit: f219398bdeb3b7d0e260d92e7106d8cb219356c7
implementation_commit: 1f48136
review_package: dist/review/WEB-REVIEW-SUBMIT-1-REVIEW-PACKAGE.zip
```

## 变更文件

### 产品代码

- `src/features/webgpt/adapter/webgpt-page-adapter.ts`
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts`
- `src/features/webgpt/runtime/webgpt-operation-budget.ts`
- `src/features/webgpt/runtime/webgpt-workspace.ts`
- `src/features/webgpt/review-submission/review-submission-types.ts`
- `src/features/webgpt/review-submission/webgpt-review-submission-service.ts`
- `src/main/main.ts`
- `src/main/webgpt-command.ts`
- `src/main/webgpt-control.ts`
- `src/shared/control-plane-errors.ts`
- `src/shared/webgpt-control-plane-contract.ts`

### 测试与文档

- `tests/webgpt-review-submission.test.ts`
- `docs/WEB-REVIEW-SUBMIT-1-REALITY-AUDIT.md`
- `docs/WEB-REVIEW-SUBMIT-1-DESIGN.md`
- `docs/WEB-REVIEW-SUBMIT-1-TESTS.md`
- `docs/WEB-REVIEW-SUBMIT-1-BENCHMARK.md`

## Control Plane / CLI

```text
webgpt review-submit --zip <package.zip> --summary-file <summary.txt> --target current --json
```

Control Plane 能力名为 `webgpt.review-submit`。它使用既有版本化初始化、请求 ID、认证 socket、CLI presenter 与 Arbiter；没有创建新的 transport。

## Gate Matrix

| Gate | 状态 | 证据 |
| --- | --- | --- |
| 单命令 CLI / 显式目标 | PASS | 4/4 定向测试，parser contract |
| ZIP/摘要输入边界 | PASS | Service validation + control allowlist |
| 可见 Composer / file input 适配 | IMPLEMENTED | Page Adapter + WebContents Debugger |
| 幂等重复保护 | PASS | `ALREADY_SENT` contract |
| 语义漂移保护 | PASS | `IDEMPOTENCY_CONFLICT` contract |
| unknown-after-send | PASS | reconcile-before-retry contract |
| 独立 Runner 真实网页基线 | PASS WITH LIMIT | 10/10, duplicate 0, p90 <=15s |
| Workbench 正向打包网页提交 | NOT CLAIMED | 隔离 smoke 未登录且为 `CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL`，没有伪造 `SENT` |
| Workbench warm packaged lifecycle | PASS (NEGATIVE CONTROL) | 已启动 Workbench 实例，约 304 ms 返回 typed control-owner failure，Prompt=0 |
| Workbench cold packaged lifecycle | BOUNDARY | 隔离 cold smoke 30 s 内未就绪，已停止；不影响“Workbench 已运行”目标，但未宣称 cold-start PASS |
| V1 全量回归 | PASS | 406/406 |
| V1 Frozen Core | PRESERVED | additive WebGPT integration |

## 已接受限制 / 后续边界

- 独立 Runner 的 median 13.436 秒高于原始 10 秒目标；p90 14.742 秒达到 15 秒目标。用户已接受当前水平暂不继续优化。
- Workbench 本阶段不等待 GPT 回复，不解析 GPT Gate，不自动推进下一阶段。
- 不实现多账号、多会话或独立浏览器 profile 管理。
- Workbench 正向 smoke 需要 Workbench 自身已登录且 AUTO_CONTROL 可用的 WebGPT 会话；本轮隔离 profile 返回了 `CONTROL_NOT_AVAILABLE / WEBGPT_USER_CONTROL`，未发送 Prompt。
- 冷启动自动拉起路径仍受既有启动/页面就绪预算影响；本阶段性能目标限定为 Workbench 已运行且目标 Chat 可解析，不将冷启动计入 `SENT` benchmark。

## 子代理结果

本阶段启动 4 个互不写共享文件的审计子代理，均自然完成并返回：

| 子代理 | 任务 | 结果 | 采用 |
| --- | --- | --- | --- |
| Popper | 独立 Runner 现实实现与 benchmark 审计 | 确认 Runner HEAD、10/10 SENT、median/p90 边界 | 是，作为现实基线 |
| Hegel | Workbench WebGPT 集成边界审计 | 确认复用既有 WebContentsView、Session、Page Adapter、Arbiter | 是，作为架构边界 |
| Ohm | 幂等、UNKNOWN_AFTER_SEND、控制权审计 | 建议语义漂移使用 `IDEMPOTENCY_CONFLICT`，reconcile 后才允许重试 | 是，已落入契约/测试 |
| Volta | 回归、打包与 CLI 进程审计 | 关注 packaged CLI 输出管道和生命周期收口 | 是，已落入生命周期修正与回归 |

Gate 时 `running_subagents=0`；子代理结果审核后已关闭，不留运行项。

## Gate

```text
READY_FOR_REVIEW
```

该结论表示代码、契约、自动化和独立 Runner 证据已整理完成，并明确真实 Workbench smoke 的边界；不表示未执行的正向 GUI smoke 已通过。
