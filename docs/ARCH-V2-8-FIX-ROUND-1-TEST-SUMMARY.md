# ARCH-V2-8 FIX ROUND 1 — Test Summary

## Passed

- `npm run check` — PASS
- `npm test` — 389/389 PASS
- `npm audit --omit=dev` — 0 vulnerabilities
- scoped high-risk secret signature scan — PASS
- `git diff --check` — PASS
- isolated `npm run package:win` with `CODEX_WORKBENCH_DIST=dist-stage-arch-v2-8-fix-round-1` — PASS
- real WEB-6.6 protocol smoke — PASS, 0 Prompt
- real WEB-6.4 arbiter smoke — PASS, 0 Prompt

## Standard package limitation

标准 `npm run build` / `npm run package:win` 会在清理 `D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe` 时收到 `EPERM`，因为该 EXE 正被用户当前运行实例占用。本轮未强杀进程；隔离目录 package 已完整通过，标准目录只待关闭实例后再更新。

## Scope-limited omissions

会创建 Native Thread 或发送业务 Prompt 的旧 real navigation/workspace/multi-thread scripts 未在本轮运行；原因是 FIX 指令要求真实业务 Prompt/Chat 数量为 0。389 个全量自动化测试仍覆盖对应的 contract/regression boundary。
