# WEB-6.6 Control Plane Protocol Baseline

## 阶段结论

本阶段建立并验证 WebGPT Control Plane 的版本、能力和 Schema 基线。它是 WebGPT 扩展层的本地控制协议，不改变 V1 Frozen Core，也不建立第二套 Conversation/Transcript truth。

```yaml
stage: WEB-6.6 Control Plane Protocol Baseline
result: PASS_CANDIDATE
protocol_version: 1.0
implementation_commit: 3b528cc
new_real_prompts: 0
v1_core_changed: NO
```

## Scope Resolution

### In scope

- 明确 wire envelope 与 `major.minor` protocol version；
- `webgpt.initialize` 握手、client identity、session 绑定与过期；
- capability descriptor、稳定性级别和 unsupported error；
- `VERSION_MISMATCH`、`CAPABILITY_NOT_SUPPORTED` 等结构化错误；
- 机器可读 JSON Schema 及构建/打包产物；
- 官方 CLI 的 initialize → business command 顺序；
- 受限 legacy compatibility window 和诊断标识；
- 不产生网页 Prompt 的真实 Control Plane smoke。

### Out of scope

- Browser UI、Browser Pane、Automation、Planner、Reviewer、Workflow；
- 新建 Project、Chat 或发送真实 Prompt；
- Native Thread / Turn / Item、Runtime Registry、Composer、Map、Request Manager 行为重做；
- 私有 ChatGPT API、Cookie/Token 提取或网络协议逆向。

## 架构边界

```text
V1 Frozen Core
  Native Thread / Native Turn / Native Item / Codex App Server
        |
        +-- WebGPT 扩展层
              Electron WebContentsView
              WebGPT Runtime
              CLI
              Control Plane
```

Control Plane 只负责本地 WebGPT 控制请求的发现、版本协商、能力声明、会话授权和结果封装。它不保存或重建聊天事实；真实页面状态仍由 WebGPT Runtime 及现有页面适配器负责。

## 协议版本与传输

- wire envelope `version` 保持为整数 `1`，用于兼容既有本地调用者；
- 权威协议版本为 `protocolVersion: "1.0"`；
- 同 major、minor `0` 为 `SAME`，minor `1` 为 `COMPATIBLE`；
- major 不同或 minor 大于当前兼容上限时返回 `VERSION_MISMATCH`；
- 传输继续使用现有 Windows Named Pipe 和 descriptor/authToken 机制；本阶段没有替换传输层。

## Initialize 与会话

现代调用者必须先发送 `webgpt.initialize`，携带：

- `protocolVersion`；
- `clientInfo.clientName`、`clientInfo.clientVersion`、`clientInfo.clientType`；
- 至少 16 字符的 `sessionId`；
- 可选的 `requestedCapabilities`。

服务器只接受 initialize 的明确字段；未知字段 fail-closed。成功后建立带 client identity 的 Control session，默认 TTL 为 30 分钟，服务端最多保留 64 个 session。后续业务请求必须携带相同的 protocol/client/session 绑定；不一致返回结构化错误，不执行操作。

冷启动时 CLI 会从 descriptor 收敛 Workbench 版本后重新 initialize，避免首次 descriptor 尚未就绪导致的伪 `CONTROL_SESSION_CLIENT_MISMATCH`。

## Capability Baseline

| Capability | 状态 | 说明 |
| --- | --- | --- |
| `webgpt.control.v1` | STABLE | 版本化 initialize 与认证请求路由 |
| `webgpt.status` | STABLE | WebGPT runtime 健康/公开页面状态读取 |
| `webgpt.project` | STABLE | Project 检查、导航和 Project-scoped chat 创建 |
| `webgpt.role` | STABLE | Role registry 与目标安全路由 |
| `webgpt.request-lifecycle` | STABLE | request status、wait、result、幂等发送生命周期 |
| `webgpt.read-latest` | STABLE | 定向 metadata/result 读取，不提交 Prompt |
| `webgpt.browser-screenshot` | EXPERIMENTAL | 通过现有 WebGPT runtime 的显式截图输出 |
| `webgpt.legacy-transport` | DEPRECATED | 旧内部调用者的受限兼容窗口 |

请求了不存在的 capability 时返回 `CAPABILITY_NOT_SUPPORTED`，不会降级成其它 capability，也不会执行原业务命令。

## Error Envelope 与安全边界

错误统一包含 `code`、`message`、`retryable`，可选 `details`。details 只允许有限安全键（例如支持/请求版本、capability、requiredCommand、compatibilityUntil、reason、retryAfterMs），并限制数量与值长度。错误文本会过滤 URL/credential-like 内容。

Schema 与 evidence 不包含：Cookie、Token 值、密码、浏览器 profile、用户私人聊天内容、Prompt、Assistant transcript 或真实 Chat URL。descriptor 的 authToken 仅作为运行时本地传输认证字段存在；真实 smoke 只记录 `authTokenCaptured: true` 和 `authTokenWrittenToEvidence: false`。

## Schema 与构建来源

唯一 Schema 来源是 `src/shared/webgpt-control-plane-contract.ts` 的 `buildControlPlaneSchema()`。`npm run build` 编译后由 `scripts/generate-control-plane-schema.mjs` 按根 `package.json.version` 生成：

```text
dist/contracts/control-plane.schema.json
```

`npm run package:win` 将同一文件复制到 packaged app resources，避免手工维护第二份契约。Schema 使用 Draft 2020-12，包含 descriptor、request、response、error、identity、diagnostics 定义和字段边界。

## 官方 CLI 调用顺序

现代 CLI 先以 `OFFICIAL_CLI` 身份执行 `webgpt.initialize`，成功取得协议/能力/会话绑定后，再发送业务 command。status real smoke 已验证该路径返回 `protocolVersion: 1.0`、`compatibilityMode: MODERN`、`clientType: OFFICIAL_CLI`。

## Legacy Compatibility

旧调用者仍可在限定窗口内使用既有 envelope，但响应明确标注 `compatibilityMode: LEGACY` 和截止时间：

```text
2026-12-31T23:59:59.000Z
```

窗口结束后旧调用者收到 `CONTROL_LEGACY_UNSUPPORTED`，不会无限期保留隐式兼容。新客户端不得依赖 legacy 路径。

## 验证边界

- `npm run check`、`npm test`、build/package、audit、diff/secret scan 均通过；
- 单元/契约测试总计 `198/198 PASS`，另有 WEB-6.6 定向协议测试 `13/13 PASS`；
- 真实 smoke 只验证 Control Plane status、版本不匹配和 unsupported capability，`newRealPrompts: 0`；
- smoke 中 `webgpt: UNAVAILABLE` 表示当时没有活动 WebGPT 页面，不是协议握手失败；
- 不把既有 WEB-6.5 role latest 的 `WEBGPT_TARGET_CHAT_MISMATCH` 上游已知限制伪装成本阶段解决。

## 文件与提交

实现提交：`3b528cc feat: establish webgpt control plane protocol baseline`

本阶段没有修改 V1 Frozen Core、旧 donor 或 Auto_Agent。最终审查报告和人工提交 ZIP 见：

- `docs/WEBGPT-WEB6.6-STAGE-REVIEW.md`
- `dist/review/WEBGPT-WEB6.6-STAGE-REVIEW-PACKAGE.zip`
