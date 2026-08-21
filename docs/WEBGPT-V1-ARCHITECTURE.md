# WebGPT V1 Architecture

## 1. 设计定位

WebGPT 是 `Codex_Workbench_V1` 上的 Browser Service extension surface。它复用 Workbench 外壳和本地 Control Plane，但不复用或改写 Native Codex 的 Thread/Turn/Item 事实。

```text
Native V1 Core                         WebGPT extension
----------------                       -----------------
Native Thread / Turn / Item             Electron WebContentsView
RuntimeRegistry                         persistent WebGPT Session
Native Approval / Sandbox               Page Adapter / Page Probe
Workspace / Renderer projection         Network Observer (metadata only)
V1 Map                                  Request Manager / Journal
                                        Role + Project Registry
                                        Browser Operation Arbiter
                                        Named Pipe Control Plane
                                        Official CLI front door
```

依赖方向为：

```text
WebGPT -> extension surface / shell
V1 Core -X-> WebGPT business dependency
```

## 2. Runtime 拓扑

```text
Codex Workbench CLI.exe
        |  argv, shell=false, stdio firewall
        v
Codex Workbench CLI Runtime.exe
        |  shared parser / presenter
        v
authenticated local Named Pipe Control Plane
        v
main process WebGPT control queue
        v
one WebGptWorkspace
        +-- one WebContentsView
        +-- one persistent Electron Session
        +-- one WebGptOperationArbiter (capacity=1)
        +-- one WebGptNetworkObserver
        +-- one Page Adapter
```

GUI 和 CLI 连接同一个 Workbench instance 时复用同一 Browser Runtime；CLI 冷启动只按需启动同目录 GUI host，不创建第二个 GUI 窗口或第二个 WebGPT Core。

## 3. Browser Runtime

`WebGptWorkspace` 创建单个 `WebContentsView`。它负责：

- ChatGPT origin allowlist 和登录 origin 边界；
- WebContentsView bounds/visibility；
- 页面加载、重定向、失败、标题和 URL 状态；
- Page Probe、Project action 脚本、Composer/Prompt 交互；
- Control Ownership 和 Browser Arbiter 接入；
- Network Observer 的生命周期协调。

远程 WebGPT view 使用：

```text
contextIsolation = true
nodeIntegration   = false
sandbox            = true
```

Workbench 本地 renderer shell 有自己的 preload/IPC 配置；远程 WebGPT 页面不接收 V1 preload bridge。

## 4. Session 与持久化

`createWebGptSession()` 通过 `session.fromPath(resolve(userData, "webgpt/session"), { cache: true })` 创建持久 session。它保存浏览器自身的 session 状态，用于减少重复登录；产品和审查包不读取或导出其中的 Cookie/Token。

WebGPT 业务持久化位于 user-data 下：

```text
webgpt/session/       Electron Session profile
webgpt/requests/      Request Journal + bounded result files
webgpt/projects/      confirmed remote Project Registry
webgpt/roles/         Project/Role -> exact Chat binding Registry
control-plane         local descriptor / protocol artifacts
```

这些文件不是 Native Transcript，也不替代 Native Thread/Turn/Item。

## 5. Browser Lease 与 Control Ownership

```text
request/command
      |
      v
WebGptOperationArbiter (capacity = 1)
      |                 \
      |                  +-- queue limit -> OVERLOADED
      +-- active lease -> BUSY for conflicting writes
      |
      v
WebGptWorkspace page action
```

`USER_CONTROL` 会阻止自动操作、暂停队列并使当前自动操作的 epoch 失效。只有显式 `control auto` 后才允许继续。Lease release、过期 lease 和队列取消均不改变 WebGPT Request identity。

## 6. Request Manager

```text
CLI send / Role send
        v
Request Manager
        +-- requestId
        +-- idempotencyKey
        +-- semanticSha256
        +-- Request Journal
        +-- Browser Lease
        +-- target Chat validation
        +-- Page Probe / Network candidate
        +-- result writer
```

状态集合：

```text
QUEUED -> SUBMITTING -> SUBMITTED -> GENERATING -> COMPLETED
                                      |             |
                                      +-> FAILED    +-> FAILED
                                      +-> RECOVERY_REQUIRED
```

`TIMEOUT` 是等待语义；`RECOVERY_REQUIRED` 是不确定状态语义。Workbench 重启时不会把未完成网页请求当成可安全重发的普通队列项。

## 7. Completion Pipeline

```text
CDP Network metadata
        |
        +-- candidate correlator (host/path/method/status/data/timing)
        v
COMPLETION_CANDIDATE
        |
        +-- exact target Chat check
        +-- bounded Page Probe
        +-- assistant/generation/text stability
        v
COMPLETED or RECOVERY_REQUIRED
```

Network `loadingFinished` 不直接宣布完成。候选必须唯一且达到分数/时间窗口约束；候选仍需页面最终确认。Network Observer 不收集响应正文。

## 8. Role / Project Routing

```text
Project + Role
      |
      v
Role Registry: exact targetChatUrl
      |
      +-- open target
      +-- send target
      +-- latest target
      v
Page Adapter exact target verification
```

未绑定、失效、当前页不匹配或 Chat URL 不可确认时 fail-closed。不会 fallback 当前页，不扫描 Sidebar/history，不静默 rebind。

Project Registry 只保存远端 Project identity；Project create/open/new-chat 通过真实 DOM 语义动作和 route/context confirmation 完成。`new-chat` 在无 Prompt 时只准备 Project context，真实 Chat identity 在首个 Prompt 后产生。

## 9. Control Plane

Control Plane 是本机版本化协议：

```text
initialize
  -> protocol/client/capability negotiation
  -> authenticated session binding
  -> allowlisted business command
  -> structured response + bounded diagnostics
```

协议主版本为 `1.0`，schema 由 `src/shared/webgpt-control-plane-contract.ts` 单一生成。Named Pipe 传输保持现状；它不是官方 Codex transport，也不需要在本阶段替换。

## 10. 边界总结

| 保证 | 实现位置 |
|---|---|
| 单 Browser / 单 Session | `webgpt-workspace.ts`, `webgpt-session.ts` |
| capacity=1 / control priority | `webgpt-operation-arbiter.ts` |
| identity/idempotency/recovery | `webgpt-request-manager.ts` |
| exact Role target | `webgpt-role-session-registry.ts`, service, workspace |
| remote Project identity | `webgpt-project-registry.ts`, page adapter |
| network candidate only | `network-observer.ts`, `request-correlator.ts` |
| protocol/error/CLI | `webgpt-control.ts`, `control-plane-errors.ts`, `webgpt-cli-presenter.ts` |
| Native truth | V1 `RuntimeRegistry`, Native Thread/Turn/Item modules |

冻结结果：WebGPT 可以作为独立 Browser Service extension 使用，但不能被误读为第二套 Native Codex 或第二种 Thread。
