# ARCH-V2-2 Runtime Reality

## Scope resolution

- Stage: `ARCH-V2-2 Shared CodexHost / Generated Protocol / Runtime Dedup`
- Base: `55a2aec` (`feat: isolate native map capability`)
- V1 Frozen Core: 保持 `Native Thread -> 唯一对话身份`、`Native Turn/Item -> 运行事实`、Codex App Server -> Runtime 主路径。
- 本阶段只收敛普通 Native Thread 的 App Server process/transport；Map 兼容维护、Project Map maintenance、WebGPT、Automation 不改产品语义。

## Q1 — AppServerProcessClient creation points

当前源码盘点：

1. `src/codex/native-thread-runtime.ts` 的默认 `clientFactory` 会创建 `AppServerProcessClient`。
2. `src/main/main.ts` 的普通 Native Thread Runtime 已改为注入 `AppServerHost.createThreadClient()`。
3. `src/main/map-coordinator.ts` 的 resumed Map compatibility fallback 保留独立 client。
4. `src/main/project-map-manager.ts` 的 bounded context reader、maintenance fallback 和 Project Map maintenance Runtime 保留独立 client/runtime。
5. `scripts/real-*.ts`、单元测试和清理脚本是测试/证据域的独立 client，不属于生产 Main 的隐藏 spawn。

## Q2 — NativeThreadRuntime points

`NativeThreadRuntime` 仍负责 Native identity、Turn、Prompt recovery、projection 和 per-thread events；它不再负责普通 Main Runtime 的 App Server process。其 `clientFactory` 注入的 `AppServerThreadClient` 只负责句柄级请求、事件和 server-request callback。

## Q3 — True process spawn

唯一底层 spawn 实现在 `src/codex/app-server-client.ts` 的 `AppServerProcessClient.start()`。普通 Main 路径由 `src/codex/app-server-host.ts` 创建一个底层 client；两个 ThreadHandle 共用该 transport。真实 smoke 已记录相同 PID。

## Q4 — RuntimeRegistry role

`RuntimeRegistry<nativeThreadId, NativeThreadRuntime>` 继续维护 Thread 级运行句柄、选择和关闭语义；共享 Host 独立拥有 process/transport/initialize 生命周期。关闭单个 Runtime 只关闭 `AppServerThreadClient` 句柄，不会关闭 Host。

## Q5 — Notification/server-request association

Host 从 `threadId`、`thread.id`、`turn.threadId`、`item.threadId` 提取路由身份。带 identity 的消息只投递到对应句柄；无 identity 的消息在多个未绑定句柄时 fail-closed。`thread/started` 在唯一未绑定句柄时允许绑定前生命周期通知。

## Q6 — Approval routing dependency

Host 只按 ThreadHandle callback 路由 server request，不实现 approval 业务。Main 既有 approval broker 仍以 `nativeThreadId + requestId` 隔离；共享 Host 单元测试验证 A 的 server request 只到 A callback。

## Q7 — Stop/interrupt dependency

`NativeThreadRuntime.interruptTurn()` 继续发送显式 `threadId + turnId` 的 `turn/interrupt`。Host 不接受当前选中 Thread 作为隐式目标。既有 per-thread interrupt regression 保留，真实共享 Host smoke 验证 A/B 事件不串线。

## Q8 — Map temporary runtime reason

Map model-facing dynamic tool 受当前 Codex CLI ABI 限制：`thread/resume` 不接受 `dynamicTools`。因此 resumed Map compatibility fallback、Project Map maintenance 和 bounded context read 暂保独立 client，并在 Spawn Topology 中白名单记录；它们不属于普通 Native Thread Host。

## Q9 — Handwritten protocol DTOs

现有 Workbench runtime 使用受限的 JSON-RPC `JsonRpcMessage` 和 bounded parser。Codex CLI `0.147.0` 实际支持 stable `generate-ts` 与 `generate-json-schema`。本阶段加入生成命令的可重复验证脚本、版本/binary/tree hash manifest，以及 Shared Host core-method allowlist；生成 TypeScript 是 type-only，不伪装成 serializer。

## Q10 — Current binary/version

```text
codex --version: codex-cli 0.147.0
Windows x64 binary SHA256: 935A1911ED5564FFCEC995F4886AC2AC425863BA26FED264DF62E30272AD9D
generation mode: stable
TS generated files: 642
JSON Schema generated files: 285
```

## Q11 — Generation capability

以下命令真实 exit code 均为 `0`，并且第二次生成的目录 manifest 与第一次相同：

```text
codex app-server generate-ts --out <dir>
codex app-server generate-json-schema --out <dir>
```

可复现入口：`npm run test:protocol:arch-v2-2`。

## Q12 — Official/source evidence for one App Server / multiple Threads

本阶段不把文档声明冒充官方保证；以真实 tested binary smoke 为证据：

- `scripts/real-multi-thread-runtime-smoke.ts`：两个不同 cwd、两个 Native Thread、一个 Host PID、两个 Turn 完成。
- `scripts/real-shared-host-recovery-smoke.ts`：一个 Host 被杀后重启，两个原 nativeThreadId 均 `resume/read` 成功。

## Reality conclusion

普通 Main Native Thread 已从“每 Thread 一个 App Server client/process”收敛到“一个 AppServerHost + 多个 AppServerThreadClient”。Map/Project maintenance 的独立进程不是隐藏普通 Thread spawn，而是有明确 capability/role 边界的兼容路径，后续可单独评估是否共享。
