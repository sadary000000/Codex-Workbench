# WEBGPT WEB-6.3：网络完成候选触发器与页面确认

## 阶段结论

```yaml
stage: WEB-6.3 Network Completion Candidate Integration
result: PASS_CANDIDATE
v1_frozen_core_changed: NO
webgpt_feature_changed: YES
real_gate_a: PASS
real_gate_b: PASS_DETERMINISTIC
production_semantics: network candidate only; Page Probe remains final authority
```

本阶段只把 Network lifecycle 接入为“完成候选触发器”，没有把
`Network.loadingFinished` 直接当成 GPT 完成，也没有改造 V1 Native Thread、Turn、
Item、Runtime Registry、Conversation truth 或 Request Manager 的幂等/恢复语义。

## 范围与架构边界

实际链路为：

```text
Request Manager
  → WebContentsView.webContents.debugger / Network.enable
  → metadata-only Network Observer
  → Request Correlator
  → unique completion candidate
  → bounded fast Page Probe confirmation
  → existing Composer/generating/stable-text semantics
  → Request Manager COMPLETED
```

Network request ID 只属于观察层；Workbench request ID 仍由 Request Manager 负责。
候选事件不会创建 Request、Thread、Transcript，也不会触发重发。

### 新增/变更模块

- `src/features/webgpt/network/network-types.ts`
  - 定义 observer health、candidate、wait diagnostics 和受限 metadata 类型。
- `src/features/webgpt/network/network-observer.ts`
  - 只使用当前 `WebContentsView` 的 in-process `webContents.debugger`。
  - 监听 `Network.requestWillBeSent`、`responseReceived`、`dataReceived`、
    `loadingFinished`、`loadingFailed` 的元数据。
- `src/features/webgpt/network/request-correlator.ts`
  - 使用 host、method、resource type、initiator、path category、数据片段数量、
    HTTP 状态、时间窗口等多信号关联；竞争候选不唯一时 fail-closed。
- `src/features/webgpt/network/completion-scheduler.ts`
  - 候选后短窗口确认；无候选或 observer 不可用时低频 reconciliation/fallback。
- `src/features/webgpt/runtime/webgpt-workspace.ts`
  - 接入 observer lifecycle、候选等待、Page Probe scheduler 和诊断。
- `src/features/webgpt/runtime/webgpt-request-manager.ts`
  - 在提交前后绑定同一 Workbench requestId；observer 失败自动回到既有 Page Probe。
  - USER_CONTROL、恢复、幂等、无盲目重发规则保持原有语义。
- `src/features/webgpt/types.ts`、`src/main/main.ts`
  - 暴露 bounded network diagnostics，不将其提升为第二事实源。
- `tests/webgpt-network-observer.test.ts`
  - observer、correlator、scheduler 和 fallback contract tests。
- `scripts/real-webgpt-web6.3-network-smoke.ts`
  - 通过打包 EXE + Node `execFile` 执行真实 Gate，输出脱敏证据。

## 生命周期与安全约束

- observer 每个 Request 最多 attach 一次，结束/导航/reload/user control 时 detach 或失效。
- active Request 被导航打断时旧候选为 `STALE`，不允许延迟旧事件影响新 Request。
- debugger attach 失败、DevTools 被其他客户端占用或 `loadingFailed` 时，转为
  `UNAVAILABLE`/`FALLBACK`，不阻塞既有 Page Probe。
- `Network.loadingFinished` 只发出候选，不等于 `COMPLETED`。
- 最终完成仍要求可观察 Assistant 变化、非 transient 文本、Composer 存在、
  generating=false、草稿为空且连续稳定样本满足既有规则。
- 只记录 bounded metadata：request ID、host、path category、method、resource type、
  initiator type、计数、状态码、时间和传输字节数。
- 不读取 Cookie、Token、Authorization、请求头、postData、response body、SSE/WebSocket
  payload、localStorage 或 Browser profile；不开放外部 debug port；不新增 Playwright、
  Selenium、mitm 或系统软件。

## 自动化验证

在当前实现工作树执行：

| 检查 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS，172/172 |
| `npm run build` | PASS |
| `npm run package:win` | PASS |
| `npm audit --omit=dev` | PASS，0 vulnerabilities |
| `git diff --check` | PASS（仅有 Git 行尾提示，无错误） |
| WEB-6.3 文件安全扫描 | PASS，无 forbidden credential/body/private-network-data access pattern |

自动化覆盖包括：

1. attach 一次、metadata-only candidate；
2. debugger attach/enable 失败转 fallback；
3. `loadingFailed` 不产生完成候选；
4. 两个强候选时保持 `AMBIGUOUS`；
5. 导航后旧事件变成 `STALE`；
6. candidate event 后 regular reconciliation probes 少于 fallback-only；
7. Request Manager 的 recovery/idempotency/no-blind-resend 既有回归继续通过。

## 真实 Gate A：网络候选 → 页面确认

真实使用最新打包 EXE，项目为 `workts`，通过 Node `execFile` 依次执行 status/open/
control/project/send/wait/result/status。最终证据位于：
`dist/review/WEBGPT-WEB6.3-REAL-GATE.json`。

```yaml
runId: web6.3-1787247730873-c0a6db65
requestId: wgpt-1fa17ea1-4cdd-4cf9-a4f3-4159df4a5915
observerMode: NETWORK
observerHealth: AVAILABLE
candidateUnique: true
candidateState: COMPLETION_CANDIDATE
candidateEmitted: true
finalState: COMPLETED
resultAvailable: true
fallbackUsed: false
pageProbeCount: 12
reconciliationProbeCount: 1
confirmationProbeCount: 11
requestIdAndNetworkIdSeparate: true
promptCount: 1
rateLimitObserved: false
```

该证据只保存命令参数的脱敏摘要、状态和 bounded diagnostics，不保存测试 Prompt、
Assistant 返回正文、Cookie 或 Token。该阶段共使用两次真实 Prompt：第一次用于确认
初始实现链路，第二次为修正候选诊断后的最终 Gate A；均未发生限流。一次更早的冷启动
预检查只得到 `WORKBENCH_START_TIMEOUT`，没有发送 Prompt，不计入真实 Prompt 次数。

Gate A 通过条件全部满足：observer 健康、唯一候选、候选事件发出、候选结束后进入
有界 Page Probe 确认、Request 最终 `COMPLETED` 且 result 可读。

## 真实 Gate B：observer 不可用 fallback

Gate B 不再消耗真实网页 Prompt，使用 test-only FakeDebugger 让 `Network.enable` 失败：

```yaml
observerHealth: UNAVAILABLE
observerMode: FALLBACK
candidate: null
page_probe_path: retained
blind_resend: NO
```

对应测试为 `debugger attach failure is unavailable and falls back without throwing`。
这证明 observer 是加速层而非完成事实源；正式 Request Manager 的 no-blind-resend、
recovery 和 idempotency 回归由既有 WebGPT Request Manager tests 继续覆盖。

## 已知限制与不在本阶段范围

- Network lifecycle 不是 GPT 私有状态；候选可能因页面/服务端实现变化而不可用或产生歧义。
- 没有逆向或调用 ChatGPT 私有接口，因此无法把网络结束直接解释为 GPT COMPLETED。
- Stop/interrupt 的网络语义没有在本阶段扩展；已有 Request Manager/USER_CONTROL 语义保持。
- 没有实现 Browser Pane、Automation、Workflow、Planner 或 Reviewer。
- WebGPT UI、V1 Frozen Core、Native Thread/Turn/Item 和 Project/Role 产品边界未修改。
- Gate B 是确定性 observer unavailable contract，不声称真实网络断开场景已人为制造。

## 阶段结论

WEB-6.3 已达到 `PASS_CANDIDATE`，可交由 GPT 审查。推荐继续使用“Network candidate
event + bounded Page Probe confirmation + low-frequency fallback”，不要把 Network
事件单独升级为完成事实。
