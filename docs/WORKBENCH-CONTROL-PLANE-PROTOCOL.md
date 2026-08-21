# Workbench Control Plane Protocol Contract

本文档是 `webgpt` 本地 Control Plane 的操作契约。示例中的 instance、pipe、session、token 均为占位符，不是实际运行凭据。

## 1. Descriptor

Workbench 在本地发布 descriptor；`authToken` 只用于本机 Named Pipe 认证，不应进入报告、日志或提交：

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "endpoint": "\\\\.\\pipe\\codex-workbench-webgpt-<instance>",
  "authToken": "<runtime-only-redacted>",
  "workbenchInstanceId": "<runtime-only-instance>",
  "workbenchVersion": "0.1.0"
}
```

`version: 1` 是历史 wire envelope 兼容字段；调用方应以 `protocolVersion: "1.0"` 做版本协商。

## 2. Initialize Request

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-initialize-001",
  "command": "webgpt.initialize",
  "sessionId": "session-00000000-0000-4000-8000-000000000001",
  "clientInfo": {
    "clientName": "codex-workbench-cli",
    "clientVersion": "0.1.0",
    "clientType": "OFFICIAL_CLI"
  },
  "requestedCapabilities": [
    "webgpt.control.v1",
    "webgpt.status",
    "webgpt.read-latest"
  ]
}
```

Initialize 不接受业务字段（例如 `url`、`text`、`projectName`）。未知字段返回 `CONTROL_FIELD_UNSUPPORTED`。

## 3. Initialize Success

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-initialize-001",
  "sessionId": "session-00000000-0000-4000-8000-000000000001",
  "ok": true,
  "command": "webgpt.initialize",
  "capabilities": [
    {
      "name": "webgpt.control.v1",
      "status": "STABLE",
      "description": "Versioned Control Plane initialize and authenticated request routing."
    },
    {
      "name": "webgpt.status",
      "status": "STABLE",
      "description": "Read WebGPT runtime health and public page state."
    }
  ],
  "serverInfo": { "workbenchVersion": "0.1.0" },
  "diagnostics": {
    "protocolVersion": "1.0",
    "compatibilityMode": "MODERN",
    "clientType": "OFFICIAL_CLI"
  }
}
```

## 4. Modern Business Request / Response

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-status-001",
  "command": "webgpt.status",
  "sessionId": "session-00000000-0000-4000-8000-000000000001"
}
```

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-status-001",
  "sessionId": "session-00000000-0000-4000-8000-000000000001",
  "ok": true,
  "command": "webgpt.status",
  "result": {
    "workbench": "READY",
    "webgpt": "UNAVAILABLE"
  },
  "diagnostics": {
    "protocolVersion": "1.0",
    "compatibilityMode": "MODERN",
    "clientType": "OFFICIAL_CLI"
  }
}
```

`UNAVAILABLE` 仅表示当前没有可用 WebGPT 页面/runtime；它不等同于 Control Plane 不可用。

## 5. Fail-closed Examples

### 未 initialize

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-before-init",
  "command": "webgpt.status"
}
```

```json
{
  "version": 1,
  "protocolVersion": "1.0",
  "requestId": "req-before-init",
  "ok": false,
  "command": "webgpt.status",
  "error": {
    "code": "CONTROL_INITIALIZE_REQUIRED",
    "message": "现代 Control Plane 请求必须先完成 initialize。",
    "retryable": false,
    "details": { "requiredCommand": "webgpt.initialize" }
  }
}
```

### Version mismatch

```json
{
  "ok": false,
  "command": "webgpt.initialize",
  "error": {
    "code": "VERSION_MISMATCH",
    "message": "Control Plane protocol version 不兼容。",
    "retryable": false,
    "details": { "supportedVersion": "1.0", "requestedVersion": "2.0" }
  }
}
```

### Unsupported capability

```json
{
  "ok": false,
  "command": "webgpt.initialize",
  "error": {
    "code": "CAPABILITY_NOT_SUPPORTED",
    "message": "不支持的 Control Plane capability。",
    "retryable": false,
    "details": { "capability": "webgpt.unknown" }
  }
}
```

### Legacy response

```json
{
  "version": 1,
  "requestId": "legacy-request-001",
  "ok": true,
  "command": "webgpt.status",
  "diagnostics": {
    "compatibilityMode": "LEGACY",
    "legacyCompatibilityUntil": "2026-12-31T23:59:59.000Z"
  }
}
```

Legacy 只在截止日期前可用，现代调用方不得省略 initialize。

## 6. Contract Rules

- `requestId`、`sessionId`、client 字段和文本字段都有长度上限；`timeoutMs` 上限为 300000；capability 数组去重且有数量上限；
- request/response 使用 `additionalProperties: false` 的结构化对象定义；`result` 保留为业务 payload，不改变 V1 事实源；
- `identity` 与 `diagnostics` 只传本地运行关联和时序信息，不承载聊天 transcript；
- 禁止在协议字段、错误 details、evidence 或 package 中写入 Cookie、Token、密码、浏览器 profile、Prompt、Assistant 内容和私人 Chat URL；
- Control Plane 不创建替代 Native Thread，不发送隐含 Prompt，不改变 Project/Role binding；
- Schema 的唯一来源是 `src/shared/webgpt-control-plane-contract.ts`，构建时生成 `dist/contracts/control-plane.schema.json`，打包时复制到 app resources。
