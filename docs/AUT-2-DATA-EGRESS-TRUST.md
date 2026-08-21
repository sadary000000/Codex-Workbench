# AUT-2 Data Egress / Trust Boundary

## 允许的上下文

调用方必须显式提供 `ContextItem`，每项有 category、trustLabel、content 和可选 path/mediaType。默认允许 bounded Summary、Diff、Log、Evidence、Architecture Context 与 Project Content。

Project Content 统一标记为 `UNTRUSTED_PROJECT_CONTENT`，即使文本包含“忽略之前指令”等 prompt-injection 文本，也只作为数据，不会升级为 trusted instruction。

## 必须拒绝

- `.env`、credentials、secrets、cookies、token、private key、auth.json 等路径。
- API key、password、Bearer、Cookie、私钥等敏感内容。
- 二进制内容、NUL 文本、非文本 media type、超出 item/payload 上限的数据。
- 未声明类别、未声明 trust label 或部分 payload 可通过但整体被拒绝的情况。

拒绝时只返回 bounded reason/count，不回显 secret、Cookie、Token、raw transcript、raw HTML 或完整私人聊天内容。`RequirementEgressPolicy.serialize()` 只有在整个 payload 通过后才生成发送包。

## 证据

`tests/aut2-egress-policy.test.ts` 和 `tests/aut2-requirement-service.test.ts` 覆盖安全内容、默认阻断路径、注入文本、二进制、大小上限、payload 全量拒绝和服务侧 `DATA_EGRESS_BLOCKED`。
