# ARCH-V2-8 Capability Matrix

## 状态定义

- PASS：当前事实直接证明。
- PASS_WITH_LIMITATION：核心事实成立，但有明确边界。
- STATIC_ONLY：仅由源码/契约或 schema 证明，未做真实副作用操作。
- FAIL_WITH_EVIDENCE：真实运行证据未通过，保留原始错误语义。
- NOT_TESTED：本阶段按安全边界未执行。

| 能力 / Gate | 状态 | 证据 | 备注 |
|---|---|---|---|
| CLI version discovery | PASS | codex --version | 返回 codex-cli 0.147.0 |
| App Server stdio launch | PASS | 实际 initialize smoke | 使用当前 Codex 二进制 |
| initialize response shape | PASS | userAgent/platform/codexHomePresent | 不保存 codexHome 原值 |
| generated protocol schema | PASS | 361 files + SHA-256 | 只保存摘要与哈希 |
| initialize capability contract | PASS_WITH_LIMITATION | schema + source allowlist | 实际 userAgent 版本漂移 |
| version compatibility contract | FAIL_WITH_EVIDENCE | 0.147.0 vs 0.148.0-alpha.9 | 本阶段不改 verified allowlist |
| thread/start | STATIC_ONLY | source allowlist + schema | 为避免副作用未启动真实 Thread |
| thread/read | STATIC_ONLY | source allowlist + schema | 未对真实历史 Thread 做读取 |
| thread/resume | STATIC_ONLY | source allowlist + schema | 未执行真实恢复 |
| turn/start | STATIC_ONLY | source allowlist + schema | 未发送真实业务 Prompt |
| turn/interrupt | STATIC_ONLY | source allowlist + schema | 未制造真实运行中的业务 Turn |
| Native Thread identity boundary | PASS | V2-1~V2-7 regression/source | Native identity remains canonical |
| persistence/recovery boundary | PASS_WITH_LIMITATION | V2-7 harness and docs | provider-local journal is not workflow truth |
| packaged build | PASS | npm run build | standard dist |
| packaged Windows output | PASS | npm run package:win | standard dist/package |
| packaged official CLI status smoke | FAIL_WITH_EVIDENCE | bounded TIMEOUT, 15070 ms | 不声称完整 real protocol PASS |
| business Prompt / new business Chat | NOT_TESTED | explicit safety scope | 本阶段必须为 0 |

## Capability conclusion

当前可以确认“协议入口和 schema 可发现、initialize 可启动”，不能确认“当前 Workbench 版本白名单与实际 App Server 版本完全兼容”，也不能以一次官方 CLI status timeout 宣称完整 Control Plane real Gate 通过。最终裁决交由 GPT。
