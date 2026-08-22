# ARCH-V2-3 CLI Query Evidence

## Public surface

新增窄化命令：

```text
Codex Workbench V1.exe webgpt request status --request-id <id> --json
Codex Workbench V1.exe webgpt request reconcile --request-id <id> --json
```

`status` 是 query；`reconcile` 是显式恢复/导航 command。二者共享稳定 Control Plane envelope，但不共享隐式副作用。

## Contract evidence

- `src/main/webgpt-command.ts` 解析两种命令并要求唯一 `--request-id`。
- `src/shared/webgpt-control-plane-contract.ts` allowlist 两个独立 command。
- `src/main/webgpt-control.ts` 分别校验 target request ID 和允许字段。
- `tests/webgpt-command.test.ts` 覆盖 CLI parser。
- `tests/webgpt-control-contract.test.ts` 覆盖 Control Plane parser。

## Output boundary

本阶段没有改变已有 CLI Presenter、JSON envelope 或 exit-code contract；只增加显式 reconcile command，避免 status 为恢复动作承担业务副作用。
