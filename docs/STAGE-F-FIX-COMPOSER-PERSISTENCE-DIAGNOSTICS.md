# STAGE F FIX — Composer 配置持久化 + Diagnostics 可观测性

日期：2026-08-18
基线：`095636a`
状态：实现完成，等待 GPT 审查与用户人工复测
范围：只闭环 F-FIX-01 / F-FIX-02，不进入 STAGE G

## 1. scope_resolution

### diagnostics_request_observability

Diagnostics 必须记录 Main/Runtime 实际构造的 `turn/start` 请求选项，而不是 Renderer 猜测值。记录范围为 `nativeThreadId`、`localRunId`、时间、model、effort、approvalPolicy、sandboxPolicy、文本输入能力和附件边界；不复制完整 Prompt。当前记录语义明确为 `Requested / Sent`，不宣称 App Server 已确认的 effective runtime 值。

### composer_preference_restart_persistence

按 `nativeThreadId` 独立保存 model、reasoning effort、approvalPolicy、sandbox。旧 v1 状态缺失新集合时兼容读取为空集合；未保存 Thread 才使用本次 capability discovery 的默认值。保存的 model/effort 若当前能力不支持，保留原值并在 Composer 中显示不可用，禁止静默替换或发送。

## 2. architecture_boundary

```text
Native Thread → 唯一对话身份
Native Turn / Native Item → 唯一运行事实
App Server → Runtime 主路径
Workbench persistence → 仅保存按 Native Thread 绑定的下一 Turn UI preference
Diagnostics → 按 Native Thread 的 bounded request trace，不建立 Transcript truth
```

Renderer 只负责展示、选择和按 Thread 缓存当前值；Main/Runtime 负责解析、映射和发出精确请求。偏好不写入 Native Thread、Turn、Item 或 Conversation transcript。附件仍为 deferred。

## 3. implementation

- `src/shared/runtime-types.ts`：增加 `ComposerPreferenceRecord`、顶层 `composerPreferences` 和 `ComposerRequestDiagnostics` 类型。
- `src/shared/persistence-store.ts`：增加兼容旧状态文件的顶层偏好集合、原子读写、按 `nativeThreadId` 的 get/save 和输入校验。
- `src/codex/native-thread-runtime.ts`：在实际 `turn/start` payload 构造后、发送前产生 bounded Composer request trace；不包含 Prompt。
- `src/main/main.ts`：发送精确 Composer request Diagnostics IPC；提供偏好读写 IPC；非法偏好不静默降级。
- `src/preload/preload.cts`：暴露偏好读写和 request Diagnostics listener。
- `src/renderer/renderer.ts`：恢复顺序为 preference load → capability discovery → capability validation → UI；过期 model/effort 保留为 disabled unavailable 项，发送前 fail-closed；Diagnostics 按事件携带的 Thread ID 入桶。
- `src/codex/composer-capabilities.ts`：增加不替换原值的 capability validation helper。
- `tests/*` / `scripts/real-composer-*`：增加持久化、过期值、精确 request trace 和真实能力 smoke 断言。

## 4. active_thread_truth / composer_send_guard

发送继续要求：

```text
requested nativeThreadId == selected nativeThreadId == runtime nativeThreadId
runtime state == READY
saved model/effort ∈ discovered capabilities
```

任一不满足即不调用 `turn/start`。Diagnostics request 使用 Runtime 当次实际 options，并按事件自身 `nativeThreadId` 入桶；A 的异步结果不会因为用户切换到 B 而写入 B。没有 Thread ID 的 server request 不再回退到当前选中 Thread，进入全局 Diagnostics；Approval 仍 fail-closed。

## 5. tests

- `npm run check`：PASS。
- `npm test`：PASS，95/95。
- `npm run test:real:composer-persistence`：PASS；重建 Persistence Store 后 A/B 两个 Thread 的偏好保持独立。
- `npm run test:real:composer-capability`：PASS；真实 App Server `model/list`、非默认/能力内参数映射和 Turn 完成，并断言 Runtime request trace 与实际配置一致。
- `npm run build`：PASS。
- `npm run package:win`：PASS；`D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`。
- `npm audit --omit=dev`：PASS，0 vulnerabilities。
- `git diff --check`：PASS。
- changed-source secret scan：PASS；仅命中既有测试 fixture 的 `token: "kept"` 字面量，无凭据、Cookie、Token 或私钥。

## 6. stage_a_e_regression

保留 STAGE A 的 RuntimeRegistry、多 Thread 并行、Approval/Stop 隔离、writer conflict、orphan fail-closed、restart/reopen 和 Native ID 不替换；保留 STAGE B 的滚动/Composer 布局；保留 STAGE C–E 的默认投影、Diagnostics 分层、Header、Message Stream 和 source 定位。完整回归命令已执行并 PASS。

## 7. real_appserver_smoke

真实 capability smoke 已扩展为断言 Runtime 在真实 App Server Turn 前发出的 Requested/Sent 字段。偏好重启恢复使用隔离临时状态文件的 persistence smoke；它不冒充 Electron GUI 或真实远端过期模型场景。`npm run test:real:navigation`、`npm run test:real:workspace`、`npm run test:real:multi-thread` 均 PASS。

## 8. manual_retest_required

1. 选择非默认 Model/Reasoning，发送后展开 Diagnostics，确认显示同一 Thread 的 Requested/Sent 参数。
2. 为 A/B Thread 设置不同偏好，切换并分别发送，确认设置、消息和 Diagnostics 不串线。
3. 重启 Workbench，重新打开同一 Native Thread，确认保存的 Model、Reasoning、Approval、Sandbox 恢复。
4. 用已不再提供的保存 model/effort 验证 UI 保留“已不可用”，且 Send 被禁止，改选有效值后才可发送。
5. 复测 STAGE A–E 的多 Thread、Approval、Stop、滚动、Jump to latest、Composer 常驻和 Diagnostics 定位。

## 9. subagents

| agent | task | natural completion | result | adopted | final status |
| --- | --- | --- | --- | --- | --- |
| Russell | persistence schema / migration / Native ID key audit | 已自然完成 | 确认仅有内存 preference，发现类型已先行但 Store 未实现；建议顶层按 ID 集合和旧文件兼容 | 是 | reviewed and closed |
| Aquinas | capability discovery / restore ordering / unsupported value audit | 已自然完成 | 发现恢复顺序与过期 model/effort 校验缺口；确认旧文件缺字段必须兼容 | 是 | reviewed and closed |
| Hubble | exact diagnostics request / per-thread isolation audit | 已自然完成 | 确认无法观察实际 turn/start 参数，发现异步 Diagnostics 可能按当前 Thread 错桶 | 是 | reviewed and closed |

## 10. local_user_files_status

- `dist-stage-a/`：保持用户原状态，未加入、未修改、未删除。
- `指导文档/*.docx`：保持用户原状态，未加入、未修改、未删除。
- 未创建已取消的 `STAGE_F_DENY_TEST.txt`。

## 11. legacy_project_status

旧 donor `D:\办公\AI\Codex_Workbench` 保持只读，未修改；其原有 dirty baseline 未触碰。旧 `D:\办公\AI\Auto_Agent` 未作为产品目录。

## 12. known_limitations / blockers

- 当前 Diagnostics 证明的是 Workbench 构造并提交的 Requested/Sent 参数，不是 App Server 回报的 Runtime effective 参数；协议没有被伪造扩展。
- 附件 capability 与持久化继续 deferred。
- 真实 GUI 重启恢复、过期能力呈现和 Approval Allow/Deny 仍需用户人工复测；CLI smoke 不冒充 GUI PASS。
- 当前无 blocker；阶段完成后等待 GPT 审查，不进入 STAGE G。

## 13. gate

实现与自动化 Gate：PASS。
目标：`READY_FOR_GPT_REVIEW`；完成独立 commit 后等待 GPT 审查，不进入 STAGE G。
