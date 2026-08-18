# STAGE F — Composer Capability + Approval

日期：2026-08-18  
状态：实现完成，等待 GPT 审查与人工 Approval 验收  
范围：不进入 STAGE G

## 1. scope_resolution

**STAGE F NAME:** Composer Capability + Approval  
**GOAL:** 将真实 App Server 已支持的 Model、Reasoning、Approval Policy、Sandbox 与 Composer Send/Stop 接入同一 Native Turn 链路，并保持审批按 Thread 隔离。  
**IN SCOPE:** capability discovery、按 Thread 的下一 Turn preference、显式 Composer target、模型/推理/审批/沙箱映射、现有 Native approval broker 的 UI 复用、契约与真实 smoke。  
**OUT OF SCOPE:** 附件 picker、权限 profile 产品化、Conversation/Transcript/Task/Agent truth、Thread settings 持久化、Stage G。  
**EXPECTED PRODUCT BEHAVIOR:** 选择 Thread 后动态读取模型与 reasoning effort；Composer 的选项只影响下一条消息；发送前严格校验 Thread ID 与 READY runtime；`on-request` 继续进入原生审批卡片；不支持的附件明确延后。  
**ARCHITECTURE BOUNDARY:** Native Thread/Turn/Item/App Server 是唯一运行事实；Renderer 只保存按 nativeThreadId 分桶的临时偏好；Main 只做 target/参数校验与映射；审批继续使用现有 Native broker。  
**DEPENDENCIES ON STAGE A/B/C:** 保留多 Thread RuntimeRegistry、fail-closed target、固定 Header/独立 Conversation scroll/常驻 Composer、消息投影与 Diagnostics 分层。  
**MANUAL ACCEPTANCE:** 需要人工验证模型/推理选择、Approval Allow/Deny、A/B 同时运行与切换、长对话/Composer 布局回归。  
**GATE:** 自动化与真实 capability smoke 已通过；等待 GPT 审查和用户 GUI Approval 验收。

## 2. source_documents

- `指导文档/Workbench_V1_人工验收界面整改与后续计划_2026-08-18_v1.1.docx`（只读规划输入）
- `指导文档/Workbench_V1_功能范围冻结_2026-08-17.docx`（只读规划输入）
- `docs/STAGE-A-MULTI-THREAD-RUNTIME.md`
- `docs/STAGE-A-POST-ACCEPTANCE-FIX.md`
- `docs/STAGE-B-IMPLEMENTATION.md`
- `docs/STAGE-C-UI-PROJECTION-DIAGNOSTICS.md`
- `docs/STAGE-E-THREAD-HEADER-CONVERSATION-STREAM.md`
- `docs/WORKBENCH-V1-CONVERSATION-MAP.md`
- Codex CLI 0.147.0 help/schema/真实 App Server 探针

## 3. implementation

- `src/codex/composer-capabilities.ts`：安全归一化 `model/list`，生成默认偏好，并将偏好映射为 Native `turn/start` 参数。
- `src/codex/native-thread-runtime.ts`：增加 `model/list` discovery；`startTurn` 支持原生 turn options；保持 Native ID 校验与现有状态机。
- `src/main/main.ts`：新增 capability IPC；Composer Turn 必须携带显式 `nativeThreadId`，禁止缺失 target 回退到旧选中 Thread；Main 校验并构建 sandbox policy。
- `src/preload/preload.cts`：暴露 capability discovery 和带显式 target/preferences 的 Turn API；移除静默截断 prompt。
- `src/renderer/index.html` / `src/renderer/renderer.ts`：增加紧凑模型、推理、审批、沙箱控件；按 Thread 缓存下一 Turn 偏好；保持 Composer 在 Conversation 外。
- `tests/composer-capabilities.test.ts`、`tests/native-thread-runtime.test.ts`、`tests/workspace-layout-contract.test.ts`：覆盖映射、Native identity、布局。
- `scripts/real-composer-capability-smoke.ts`：真实 App Server capability + Turn smoke，创建的临时 Thread finally 删除。

## 4. approval / attachment boundary

Approval 仍是 Native server request，不新增本地权限协议。现有 broker 继续用 Thread + RPC ID 隔离，Renderer 继续按 Thread 显示真实审批卡片。真实 Allow/Deny 触发条件依赖审批策略与 Codex 环境，本次自动 smoke 未伪造触发结果，人工验收必须补齐。

附件 schema 已审计但没有安全 picker，因此 UI 明确 deferred；不得把 generic attachment 或未验证的 local path 发送给 App Server。

## 5. tests

- `npm run check`：PASS
- `npm test`：PASS，91/91
- `git diff --check`：PASS
- `npm run test:real:composer-capability`：PASS；真实模型 `gpt-5.6-sol`、`medium`，同一 Native Thread Turn completed
- 本阶段未用 fake smoke 冒充真实 App Server；审批真实触发状态如上明确保留为人工验收项

最终 Gate：`npm run build` PASS；`npm run package:win` PASS，最新 GUI 基线为 `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe`；`npm audit --omit=dev` PASS（0 vulnerabilities）；secret scan PASS；Stage A/B real regression PASS。

## 5.1 stage_a_regression

`test:real:multi-thread` PASS；`test:real:navigation` PASS；`test:real:workspace` PASS。多 Thread、Runtime identity、Stop/interrupt、restart/reopen 和事件归属未回归。显式 Composer target 缺失时 Main 返回 `THREAD_TARGET_MISMATCH`，不再回退到旧选中 Thread。

## 5.2 stage_b_regression

`npm test` 中 workspace layout/scroll contract PASS；Composer 新增控件仍位于 `.workspace-conversation` 外，Conversation 仍是唯一主要滚动区域，未改变 Jump to latest 和常驻输入布局。

## 5.3 stage_c_regression

`npm test` 中 diagnostics/message projection contract PASS；Composer capability discovery 失败时仅显示能力不可用提示，不把 raw protocol 数据写入默认消息流；能力与错误仍可在 Diagnostics 定位。

## 6. subagents

| agent | task | natural completion | result | adopted | final status |
| --- | --- | --- | --- | --- | --- |
| James | App Server CLI/schema/runtime capability audit | 已自然完成 | 真实 CLI 0.147.0、model/list、approval/sandbox、image input 证据 | 是 | reviewed and closed |
| Hilbert | Composer mapping / target audit | 已自然完成 | 发现显式 target 回退风险、prompt 静默截断风险；指导本次 fail-closed 修正 | 是 | reviewed and closed |
| Chandrasekhar | Approval broker/security audit | 已自然完成 | 确认现有 Native broker 隔离；真实 Approval 仍需 GUI 验收 | 是 | reviewed and closed |
| Ptolemy | Stage A-E UI/regression audit | 已自然完成 | 约束 Composer 外置、滚动/投影/Approval 不回归 | 是 | reviewed and closed |

`running_subagents_at_gate: 0`

## 7. local_user_files_status

- `dist-stage-a/`：保持未跟踪、未修改、未加入提交。
- `指导文档/*.docx`：保持用户原状态、未加入提交。
- schema 探针输出在系统临时目录，未进入项目。

## 8. legacy_project_status

旧 donor `D:\办公\AI\Codex_Workbench` 只读，未访问修改；其原有 dirty baseline 未触碰。旧 `D:\办公\AI\Auto_Agent` 只读，未作为产品目录。

## 9. known_limitations / blockers

- 真实审批 Allow/Deny 尚未在自动 smoke 中稳定触发；不阻塞原生 broker 接入，但阻塞“真实 GUI Approval 全闭环”声明，需人工验收。
- 附件 picker 与 localImage/audio/skill/mention 延后。
- 本地 preference 是会话内按 Thread 缓存，重启后不恢复为 Native settings；这是避免建立第二事实源的刻意边界。

## 10. gate

实现与自动化内部 Gate：READY_FOR_GPT_REVIEW。  
Stage F 完成后停止，不进入 Stage G。
