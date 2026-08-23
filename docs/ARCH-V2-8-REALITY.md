# ARCH-V2-8 Reality

## 状态

- 阶段：ARCH-V2-8 — Capability / Frozen Confirmation / Compatibility Regression / Final Architecture Freeze
- 当前状态：READY_FOR_GPT_FINAL_REVIEW
- 本文不是 FINAL_FROZEN 声明。
- 工作仓库：D:\办公\AI\Codex_Workbench_V1
- 审计基线 HEAD：17f7c9bd096ec6aad94b8106af2a11157d25ec82
- 本阶段 real_business_prompts：0
- 本阶段 new_business_chats：0
- AUT-2 / AUT-3 / AUT-4+：未启动

## 真实版本与协议事实

### CLI 版本

codex --version 返回：

codex-cli 0.147.0

### App Server 初始化事实

使用当前实际 Codex 二进制启动 stdio App Server，仅发送 initialize，不创建 Thread、不发送 Turn、不执行业务 Prompt。返回的脱敏事实为：

~~~json
{
  "userAgent": "Codex Desktop/0.148.0-alpha.9 (Windows 10.0.19045; x86_64) dumb (arch-v2-8-read-only; 1.0.0)",
  "platformFamily": "windows",
  "platformOs": "windows",
  "codexHomePresent": true
}
~~~

实际二进制 SHA-256：

F29F609375F3731D8DB507A95124862A84E306982E30BA4300DDCE5638BC6946

结论：initialize 数据结构可观察且返回成功，但当前 CLI 版本 0.147.0 与实际 App Server userAgent 的 0.148.0-alpha.9 不一致。Workbench 当前 verified allowlist 仍是 0.147.0。本阶段不擅自放宽版本白名单，作为兼容性 Gate 证据提交 GPT。

## 协议 Schema 事实

当前实际命令生成 JSON Schema 成功：

- codex app-server generate-json-schema --experimental --out <temporary-dir>：PASS
- 生成文件数：361
- codex_app_server_protocol.schemas.json：BABFD5C98CD978DD858B4762CDFBC9FBA941E1A0E4053DE0050E4082AE1F075A
- codex_app_server_protocol.v2.schemas.json：FF10829CD75B67297019B39AB508AC699198574663579AA18336B7DC55EA178F
- Schema 中可见 initialize、thread/read、turn/start 与 capabilities 定义。

## Workbench 代码边界

- App Server 由 src/codex/app-server-client.ts 以 app-server --stdio 启动。
- JSON-RPC 采用 line-delimited JSON；请求为 JSON-RPC 2.0。
- src/codex/app-server-capabilities.ts 当前 verified version 为 0.147.0。
- 必需方法 allowlist：initialize、thread/start、thread/read、thread/resume、turn/start、turn/interrupt。
- 必需通知 allowlist：thread/started、turn/started、turn/completed、item/started、item/completed。
- src/codex/app-server-protocol-contract.ts 保留稳定协议契约和生成证据，不承担第二套消息事实。

## 当前 package 事实

本阶段执行 npm run build 和 npm run package:win 均 PASS。当前标准包：

D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe

当前 SHA-256：

31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC

Packaged app resource hashes：

- resources/app/dist/main/main.js：EFC89E08CBBF973B8DCF59D594174515A2F2BA07AD69833FFE103345C869DA84
- resources/app/dist/renderer/renderer.js：400E6F3C9F3699F1327FAE6B5C50342FDB0F83B6DF420CF839B365436E2BCDBB
- resources/app/package.json：1BEA3D35305D3499CBDC1D7F2B17FE03FF2A9F51978C080C8C925FB18C1B385F

以上是本次实际 package 产物的 provenance，不把历史报告中其他资源哈希当作当前产物。

## 真实 smoke 限制与异常

已有隔离 packaged protocol smoke 的官方 CLI status 结果：

~~~json
{
  "ok": false,
  "command": "webgpt.status",
  "diagnostics": {
    "elapsedMs": 15070,
    "protocolVersion": "1.0",
    "compatibilityMode": "MODERN",
    "clientType": "OFFICIAL_CLI"
  },
  "error": {
    "code": "TIMEOUT",
    "retryable": true
  }
}
~~~

这是真实的有界 timeout 证据；不是把 timeout 泛化为网络失败，也不是本阶段擅自修改 Control Plane。直接 App Server initialize smoke 是 PASS，但它不能证明 thread/turn 的完整真实闭环。

## 安全边界

本阶段未读取 Cookie、Token、localStorage、浏览器 profile、生产数据库或私人 ChatGPT 内容；未创建业务 Chat；未发送真实业务 Prompt。临时 schema 和 smoke 输出位于用户临时目录，不作为产品源码或审查 ZIP 的原始日志打包。
