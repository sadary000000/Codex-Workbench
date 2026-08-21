# WEBGPT WEB-6.7 阶段审查报告

## 1. Executive Summary

    stage: WEB-6.7 Control Plane Reliability
    result: PASS_CANDIDATE
    v1_core_changed: NO
    automation_layer_changed: NO
    next_stage_candidate: WEB-6.8（仅作为后续候选，本阶段不进入）
    base_commit: 3c5e23a8c4c0f7321312bbcd3c4026fd2bfab069
    implementation_commit: 0216cc4

本阶段建立了 WebGPT Control Plane 的统一错误语义、边界 Envelope、CLI 输出 Presenter 和 Browser 操作队列容量边界。没有修改 Native Thread / Turn / Item、V1 Runtime Registry、Project、Composer、Role 路由或 WebGPT 页面探针，也没有开始 Automation。

## 2. Scope Resolution

### In scope

- 统一机器可读错误码和错误元数据；
- Control Plane 错误 Envelope 的校验、归一化和安全 details；
- BUSY 与 OVERLOADED 的语义分离；
- CLI 的 human / JSON / exit code 输出分层；
- 相关契约测试和 WEB-6.5R / WEB-6.6 回归。

### Out of scope

- Automation、Workflow、Planner、Scheduler；
- WebGPT 页面状态探索或新页面能力；
- V1 Frozen Core 重构；
- 新的 ChatGPT Project / Role / Chat 功能；
- 真实网页 Prompt 压测或限流绕过。

## 3. Architecture Boundary

    Request / Command
            |
            v
    WebGPT Control Plane
            |
            v
    Error Taxonomy + Error Envelope
            |
            +---- CLI Result Presenter
            |
            +---- future Automation consumer（本阶段不实现）

V1 事实源仍保持：

    Native Thread → 唯一 Conversation identity
    Native Turn / Native Item → 唯一消息和运行事实
    Codex App Server → V1 Runtime 主路径

WebGPT 仍是 V1 之上的扩展能力，不建立第二套 Conversation truth、Transcript truth、Task truth 或 Exec-history reconstruction。

## 4. Implementation

### 4.1 Error Taxonomy

Control Plane 对外统一暴露以下 11 个 canonical code：

| code | 语义 | 默认 retryable | 默认 userAction |
| --- | --- | --- | --- |
| INVALID_ARGUMENT | 请求参数或格式无效 | false | fix_request |
| NOT_FOUND | 目标、运行时或资源不存在 | false | verify_target |
| BUSY | 资源存在，但当前被暂时占用 | true | retry |
| OVERLOADED | 系统/队列容量已满 | true | retry_later |
| TIMEOUT | 操作超过等待期限 | true | inspect_status |
| RECOVERY_REQUIRED | 需要重新对账、恢复或重新附着 | false | reconcile_request |
| USER_CONTROL | 当前操作需要用户控制或暂停 | false | return_auto_control |
| VERSION_MISMATCH | 协议版本不匹配 | false | initialize |
| CAPABILITY_NOT_SUPPORTED | 当前能力/命令不可用 | false | use_supported_capability |
| TARGET_CHAT_MISMATCH | 目标 Chat 与当前绑定不一致 | false | reopen_target_chat |
| INTERNAL_ERROR | 未分类内部失败 | false | inspect_diagnostics |

旧的内部错误码仍可在模块内部使用；Control Plane 边界将其映射为 canonical code，并在安全的 details.legacyCode 中保留原码，便于诊断。敏感字段、Prompt、Cookie、Token、页面聊天内容不会进入 details。

### 4.2 Error Envelope

失败响应的统一形态为：

    {
      "ok": false,
      "error": {
        "code": "BUSY",
        "message": "目标浏览器操作正在执行。",
        "retryable": true,
        "retryAfterMs": 250,
        "userAction": "retry",
        "details": {
          "activeOperationType": "write"
        }
      }
    }

retryAfterMs 可为整数或 null，并限制在安全范围；userAction 有长度上限；details 使用固定 allowlist 和长度限制。现代 Control Plane 响应使用 canonical code，兼容旧客户端时保留旧 code 语义并提供 legacyCode 诊断信息。

### 4.3 BUSY / OVERLOADED

| 场景 | 返回 | 处理 |
| --- | --- | --- |
| Browser Lease / 同一资源正在执行互斥操作 | BUSY | 可按 retryAfterMs 重试，不能把资源当作容量溢出 |
| WebGPT 操作队列达到上限 | OVERLOADED | 进入退避/稍后重试，不能与资源占用混用 |

Browser operation arbiter 增加了有界队列，默认上限为 8，诊断中提供 queueLimit / queueDepth 等安全元数据；队列上限可通过测试构造参数覆盖，但不超过实现上限 64。

### 4.4 CLI Result Presenter

src/main/webgpt-cli-presenter.ts 将业务响应与输出方式分离：

| 输入/结果 | stdout | stderr | exit code |
| --- | --- | --- | --- |
| human success | 命令结果和格式化 JSON | 空 | 0 |
| human failure | 空 | COMMAND: ERROR [CODE] message | 1，参数错误为 2 |
| --json success | 单行 JSON | 空 | 0 |
| --json failure | 单行 JSON | 空 | 1，参数错误为 2 |

--out 继续由既有输出文件能力处理；Presenter 不读写文件、不启动 Electron，也不包含业务判断。

## 5. Files Changed

### Product / contract

- src/shared/control-plane-errors.ts：canonical taxonomy、legacy mapping、details sanitizer、Envelope normalization。
- src/main/webgpt-cli-presenter.ts：CLI 输出和 exit code Presenter。
- src/main/webgpt-control.ts：Control Plane 错误元数据、兼容归一化和超时响应。
- src/main/main.ts：统一失败响应和 Presenter 接线。
- src/features/webgpt/runtime/webgpt-operation-arbiter.ts：BUSY / OVERLOADED 和有界队列。
- src/shared/webgpt-control-plane-contract.ts：Envelope schema。
- dist/contracts/control-plane.schema.json：构建生成的 schema 产物。

### Tests

- tests/webgpt-control-reliability.test.ts：taxonomy、Envelope、Presenter、BUSY/OVERLOADED contract。
- tests/webgpt-feature-contract.test.ts：CLI Presenter 接线静态契约更新。

## 6. Verification

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm run check | PASS | TypeScript / 静态检查通过 |
| npm test | PASS | 204/204 |
| npm run build | PASS | 生成并校验 control-plane schema |
| npm run package:win | PASS | V1 与 CLI EXE 均生成 |
| npm audit --omit=dev | PASS | 0 vulnerabilities |
| git diff --check | PASS | 无 whitespace error |
| secret scan | PASS | 未发现 credential-like literal |
| WEB-6.6 protocol smoke | PASS | initialize/capability/schema；newRealPrompts=0 |
| WEB-6.5R contract/unit regression | PASS | 未新增真实网页 Prompt |

本阶段没有为了测试发送新的真实 ChatGPT 网页 Prompt，也没有运行可能产生限流的 WEB-6.5R live prompt smoke；因此不能把本报告解读为新的网页交互成功证据。WEB-6.6 协议 smoke 只验证 Control Plane 协议，不发送新 Prompt。

## 7. Package Provenance

实现提交：0216cc4（feat: implement webgpt control plane reliability）。

最终打包产物：

    D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
    D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench CLI.exe

已验证 SHA-256：

    Codex Workbench V1.exe        31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
    Codex Workbench CLI.exe       7FD7D691111C24ABB18FD516244639BE34C0866BF4E8D7BA5DDD4017DF1D33CE
    Codex Workbench CLI Runtime.exe 31A0176B7C1A81CF379E55E109C57A56493A4D4A9E9B0D2475A678FD7DF234DC
    packaged control-plane schema CD03B094F402DE46F1DC39C345FDB7097CB356399D951CEE6CCAD5BAC1B67643

本次审查包只包含报告、JSON 证据、测试摘要和 provenance，不包含 Cookie、Token、Browser profile、密码或私人聊天内容。报告文件所在 docs commit 与审查 ZIP 的 SHA-256 以最终 Git/文件核对为准。

## 8. Subagents

| agent | task | result | lifecycle |
| --- | --- | --- | --- |
| Arendt | Error Taxonomy 盘点 | 发现旧码分散，确认 canonical mapping 需求 | 自然完成、审核后关闭 |
| Newton | CLI Presenter / stdout / JSON / exit audit | 确认输出逻辑与业务耦合点 | 自然完成、审核后关闭 |
| Euler | Arbiter queue / backpressure audit | 发现无界队列，提出 BUSY/OVERLOADED 边界 | 自然完成、审核后关闭 |
| Ohm | WEB-6.5R / WEB-6.6 regression audit | 确认回归边界和真实 Prompt 风险 | 自然完成、审核后关闭 |

四个子代理均为本阶段独立审计，没有直接写共享产品文件；主 Agent 审核后整合结果。

    running_subagents_at_gate: 0

## 9. Known Limitations / Deferred

- 旧的内部 Request Journal / diagnostics 记录可能仍保留 legacy code 形态；本阶段保证 Control Plane / CLI 边界归一化，不迁移历史存量记录。
- Control Plane 本身仍按现有串行生命周期处理请求；本阶段只为 Browser operation arbiter 增加有界排队和明确容量错误，不引入通用调度器。
- 未产品化 RateLimitGuard、Planner、Automation、Workflow、Multi-account 或 Multi-session。
- 本阶段没有新增真实网页 Prompt，网页端限流/恢复不在本 Gate 中宣称 PASS。

## 10. Gate

    error_taxonomy: PASS
    error_envelope: PASS
    busy_overloaded_split: PASS
    cli_presenter: PASS
    regression: PASS
    tests: PASS
    v1_core_changed: NO
    blockers: none
    gate: READY_FOR_GPT_REVIEW

结论：PASS_CANDIDATE。本阶段完成后停止，不进入 WEB-6.8，不开始 Automation，审查包交由用户手动提交 GPT。
