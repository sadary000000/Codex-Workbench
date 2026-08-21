# WebGPT V1 Failure / Recovery Matrix

## 语义

- `retryable` 是控制平面错误的机器语义，不代表可以盲目重发 Prompt。
- `no-resend` 表示在目标状态未对账前不得自动提交第二次 Prompt。
- `auto-recover` 只表示可以恢复 runtime/重新读取或进入 reconcile；成功恢复不等于自动重发。

| 场景 | 检测来源 | canonical state/code | retryable | auto-recover | manual action | no-resend |
|---|---|---|---:|---|---|---:|
| GUI crash | main/runtime close + journal | `RECOVERY_REQUIRED` | no | 重新启动后加载 Journal | status/reconcile；确认后再操作 | YES |
| CLI disconnect | CLI timeout / Control Plane response boundary | `TIMEOUT` 或 `RECOVERY_REQUIRED` | yes / no | 可用同一 requestId 查询 | `request status` / `wait` | YES |
| Control Plane disconnect | authenticated pipe lifecycle | `TIMEOUT` / `RECOVERY_REQUIRED` | yes / no | 不重建业务 Request | 重新连接并查询原 requestId | YES |
| Browser reload | WebContents navigation invalidation | `RECOVERY_REQUIRED` | no | 重新读 Page Probe | 校验目标 Chat / 交还 AUTO_CONTROL | YES |
| navigation mismatch | target validation | `TARGET_CHAT_MISMATCH` | no | 不自动换页到 fallback | 显式打开精确目标 Chat | YES |
| target Chat missing | Role Registry / Page Adapter | `NOT_FOUND` 或 `RECOVERY_REQUIRED` | no | 不创建替代 Chat | 修复绑定或重新显式 bind | YES |
| Project missing | Project Registry / DOM lookup | `NOT_FOUND` | no | 不合成 remote identity | 检查 Project 名称/远端状态 | YES |
| Session/login invalid | Page Probe `loginRequired` | `USER_CONTROL` | no | 不绕过登录 | 用户在 Browser Pane 登录/恢复会话 | YES |
| wait timeout | Request Manager wait boundary | `TIMEOUT` | yes | wait 可重新查询，Request 保留 | 查询 status/result/reconcile | YES |
| request state uncertain | Journal / submit boundary | `RECOVERY_REQUIRED` | no | reconcile exact target | 确认网页 User message/状态后决定 | YES |
| USER_CONTROL takeover | Arbiter control epoch | `USER_CONTROL` / `PAUSED_FOR_USER` | no | 仅显式 return auto | 用户完成操作后 `control auto` | YES |
| Browser Lease occupied | Arbiter active lease | `BUSY` | yes | 等当前 lease release | 稍后重试同一 operation | YES |
| queue overloaded | Arbiter queue limit | `OVERLOADED` | yes | 退避后重新提交 operation | 等容量恢复 | YES |
| candidate stream ambiguous | Request Correlator | no candidate / `RECOVERY_REQUIRED` | no | Page Probe fallback/reconcile | 保留诊断，确认目标状态 | YES |
| network loading failed | Network Observer | `RECOVERY_REQUIRED` | no | Page Probe 不宣布完成 | 重新检查页面/登录/网络 | YES |
| final Page Probe mismatch | Workspace exact target check | `TARGET_CHAT_MISMATCH` / `RECOVERY_REQUIRED` | no | 不写成功结果 | 显式回到目标 Chat | YES |
| invalid idempotency reuse | Request Manager semantic hash | `INVALID_ARGUMENT` (`IDEMPOTENCY_CONFLICT`) | no | no | 使用原语义或新 key | YES |
| result output conflict | exclusive writer/integrity check | `INTERNAL_ERROR` (`WEBGPT_RESULT_CONFLICT`) | no | no | 检查目标输出文件 | YES |
| Project Registry malformed/duplicate identity | registry load validation | `INTERNAL_ERROR` (`PROJECT_REGISTRY_INVALID`) | no | no | 修复 Registry 后重新打开；不删除或替换 identity | YES |

## 状态转换约束

```text
QUEUED -> SUBMITTING -> SUBMITTED -> GENERATING -> COMPLETED
                         |
                         +-> RECOVERY_REQUIRED (submission uncertain)

WAIT timeout -> TIMEOUT / request remains queryable
USER_CONTROL -> PAUSED_FOR_USER / no page action
restart      -> RECOVERY_REQUIRED for unfinished work
```

`TIMEOUT` 不会释放一个仍可能执行的 SEND lease，也不自动启动 retry send。`RECOVERY_REQUIRED` 会保留目标 Chat、requestId、idempotencyKey 和 bounded error；如果 Journal 损坏、identity 重复或语义不一致，系统拒绝静默修复。

## 冻结证据等级

| 能力/场景 | 证据等级 | 当前结论 |
|---|---|---|
| 代码/自动化 no-blind-resend、same-key reattach、Journal fail-closed recovery | `PASS_AUTOMATED` | 未确认提交结果前不会自动发送第二次 Prompt |
| in-flight interruption → restart → no resend | `PASS_UPSTREAM_ACCEPTED` | WEB-5 最终真实 Gate 与 `WEBGPT-WEB5-FINAL-REAL-GATE-EVIDENCE.json` 记录同 `requestId`、`sameRequestId=true`、`duplicatePromptCount=0`；最终允许为 `RECOVERY_REQUIRED` |
| Role exact target / latest / latest --out | `PASS_REAL` | WEB-6.5R Fresh Chat 正向 Gate 精确读取绑定目标 |
| 复杂 Role send wrong-chat/interruption recovery | `UNKNOWN / EVIDENCE_DEFERRED` | 当前没有把更强的发送恢复场景宣称为冻结能力 |
| Project inspect/open/create/new-chat context | `PASS_REAL` | WEB-6.8 accepted real smoke；无 Prompt new-chat 不伪造 Chat URL |

`PASS_UPSTREAM_ACCEPTED` 不代表本轮新增网页 Prompt；本轮 `MAX_NEW_REAL_PROMPTS=0`。复杂 Role recovery 的 UNKNOWN 也不否定 exact-target binding、no silent rebind 和 no current-chat fallback。

## 恢复安全不变量

```text
selected/current page != target Chat -> reject
same key + same semantics          -> reattach
same key + changed semantics       -> IDEMPOTENCY_CONFLICT
uncertain submitted                -> reconcile / RECOVERY_REQUIRED
no confirmed target                -> no send
no confirmed Project identity      -> no registry write
```

所有失败路径均不得静默换 nativeThread、WebGPT Chat、Role binding、Project identity 或 Transcript truth。

## 已接受的非阻断范围

- `NON_BLOCKING / OUT_OF_SCOPE`：WEB-6.8 测试 Project 残留；Project Delete 不属于 V1。
- `NON_BLOCKING / OUT_OF_SCOPE`：完整 ChatGPT Transcript persistence、Automation、multi-account/multi-session。
