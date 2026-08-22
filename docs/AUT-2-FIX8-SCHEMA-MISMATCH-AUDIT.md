# AUT-2 Fix8 — Requirement Schema Mismatch Forensics

## 结论

本阶段针对上一轮真实 Gate 的 `SCHEMA_INVALID` 做了零 Prompt 取证、最小 Prompt 合同修复和一次受限真实首轮验证。

| 项目 | 结果 |
|---|---|
| 历史失败是否可复现为明确字段不匹配 | PASS |
| 精确不匹配 | `$.payload.questions[0].resolutionMode` |
| 规则 | `enum` |
| 收到值 | `SINGLE_SELECT` |
| 允许值 | `USER_REQUIRED`, `ASSUMPTION_ALLOWED`, `AVAILABLE_CONTEXT`, `AUTO_INVESTIGATION` |
| 最小修复 | 共享模型 Prompt 明确列出完整枚举并禁止 UI 标签 |
| Validator 是否放宽 | NO |
| Schema 是否新增别名 | NO |
| Fix8 真实首轮 schema | PASS |
| Fix8 真实 Gate 最终结果 | FAIL / FIX_REQUIRED |

真实首轮的响应已经通过 JSON、schema 和 semantic validation，并返回 `NEEDS_INPUT` 与 5 个问题；但在 Workbench 持久化该首轮时触发：

```text
AUTOMATION_SCHEMA_INVALID: round:<sanitized-id>.questionIds crosses a round boundary.
```

这是一个独立的 Automation Store / Requirement Service round identity blocker。本 Fix8 不越界修复它，也没有再次发送 Prompt。

## 历史 0-Prompt forensic read

读取对象是同一个 `workts` Project 下的 canonical REQUIREMENT Chat：

`https://chatgpt.com/g/g-p-6a85db5dd9c4819181028671e2fb9315-workts/c/6a891d7c-abf4-83e8-879a-d477e472576a`

读取通过官方 packaged CLI 的 `chat latest --url ... --json` 完成。未创建 Chat、未发送 Prompt、未保存响应正文；只在内存中执行同一 validator，并保存长度、SHA-256、shape 和字段级问题。

历史修复响应的确定性问题是：JSON 可解析，顶层 envelope 正确，但第一题的 `resolutionMode` 使用了 UI 控件标签 `SINGLE_SELECT`，而不是 schema 的机器枚举。

## 根因判断

根因分类：`PROMPT_CONTRACT` / `PROMPT_SCHEMA_DRIFT`。

更具体地说，原共享模型 Prompt 列出了字段名，却没有把 `resolutionMode` 的允许值逐项写出。模型产生了语义相近但未被协议允许的 UI 标签 `SINGLE_SELECT`。Validator 的严格拒绝行为是正确的，不能通过放宽 schema 或兼容别名来掩盖协议漂移。

## 最小变更

`REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS` 现在明确要求：

```text
Question resolutionMode must be exactly one of USER_REQUIRED, ASSUMPTION_ALLOWED, AVAILABLE_CONTEXT, or AUTO_INVESTIGATION. For a blocking fact that the user must answer, use USER_REQUIRED. Do not use UI control labels such as SINGLE_SELECT.
```

同时增加了脱敏的 `shape` 与 `validationIssues` 诊断字段，包含 path、rule、类型、枚举允许值/收到值等信息；没有加入响应正文，也没有建立第二 Transcript truth。

## Fix8 真实首轮

- Project：`workts`
- REQUIREMENT Role：临时指向同一个已有 canonical Chat，结束后恢复原绑定
- 新 Chat：`0`
- setup Prompt：`0`
- business original Prompt：`1`
- repair Prompt：`0`
- 真实累积 Prompt：`10/12`
- repair 累积：`3/3`
- 首轮响应：JSON parse `passed`；schema `passed`；semantic `passed`
- 顶层键：`requirementProtocolVersion`, `status`, `payload`
- status：`NEEDS_INPUT`
- questions：`5`
- `validationIssues`：空
- 原始响应正文：未保存

详细机器证据见 [`AUT-2-FIX8-FIRST-ROUND-REAL-EVIDENCE.json`](AUT-2-FIX8-FIRST-ROUND-REAL-EVIDENCE.json)。

## 真实 Gate 阻塞

响应通过协议后，生产 `RequirementAutomationService` 在 `applyEnvelope` 持久化首轮问题时失败，错误为 `questionIds crosses a round boundary`。因此没有得到可返回的 `WAITING_FOR_USER` 持久化 session，也没有把本次 Gate 报为 PASS。

该错误与 `resolutionMode` schema mismatch 不同，不能在 Fix8 中顺手修改。它需要后续单独的 Requirement round identity / persistence 修复和专门回归；本阶段不再产生真实 Prompt。

## 安全与边界

- 未读取 Cookie、Token、localStorage 或认证信息。
- 未保存 Prompt 正文、Assistant 正文或私人聊天正文。
- 未创建替代 Chat，未更换 native/Web Chat identity。
- REQUIREMENT 原绑定已恢复；PLANNER / REVIEWER 未改变。
- 未进入 AUT-3。

## Gate

`FIX_REQUIRED`：schema mismatch 的最小修复和真实首轮协议验证通过，但真实业务路径被独立的 round-boundary persistence blocker 阻断。
