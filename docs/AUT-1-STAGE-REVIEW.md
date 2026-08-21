# AUT-1 Gate Fix Stage Review

## Executive result

```yaml
stage: AUT-1 Domain Store + State Machine Foundation
mode: PROVISIONAL_FOUNDATION
aut0_status: NOT_FROZEN
result: PASS_CANDIDATE
```

本次 Gate Fix 只修复 AUT-1 foundation 语义，不进入 AUT-2，不连接真实 Native/WebGPT，不修改 V1 Frozen Core 或 WebGPT V1。

## Gate Fix scope

### Fixed

1. StepSpec immutable definition 与 StepRuntime mutable execution state 分离；ExecutionAttempt 绑定精确 StepSpec，Checkpoint 绑定同一 StepRuntime。
2. RequirementVersion 自包含 bounded canonical payload，并以 `payloadSha256` 校验；外部 content/structured refs 降级为 provenance。
3. ActionIntent 生成 canonical semantic descriptor 和 `semanticSha256`；同 project/idempotencyRef 的语义漂移 fail closed，不产生第二 Intent/ActionAttempt；schema 拒绝重复动作尝试快照。
4. automation schema 从 v1 升级到 v2；显式 v0/v1 migration、缺失/冲突/未来版本 fail closed。
5. Checkpoint runtime/spec/attempt/receipt 引用校验和 receipt 项目归属推导补全；state、runtime、audit 在同一 transaction 提交。
6. 增加 persistence ADR，明确当前单进程单写者 JSON snapshot 的边界与迁移触发条件。

### Out of scope

AUT-0 冻结、Planner、Reviewer、Verifier、Scheduler、Workflow Engine、Automation UI、真实 dispatcher、自动 retry、Native/WebGPT execution、Browser/CLI 接入、V1 Frozen Core 和 WebGPT V1 均未实现或修改。

## Architecture boundary

```text
V1 Frozen Core (unchanged)
        |
        +-- AUT-1 Provisional Foundation
              +-- independent automation.db (schema v2)
              +-- immutable Requirement/Plan/Stage/Step definitions
              +-- StepRuntime + ExecutionAttempt state primitives
              +-- ActionIntent semantic idempotency
              +-- receipt/recovery/checkpoint primitives
              +-- bounded audit/hash chain
```

AUT-1 不是第二套 Conversation/Transcript truth。Native Thread/Turn/Item 和 WebGPT Request 仍属于各自运行时；Automation 只保存明确的 bounded requirement payload、外部 identity/status/hash/ref 和恢复关系。

## Changed files

### Product foundation

- `src/automation/types.ts`
- `src/automation/canonical.ts`
- `src/automation/schema.ts`
- `src/automation/state-machine.ts`
- `src/automation/store.ts`
- `src/automation/index.ts`

### Tests

- `tests/automation-foundation.test.ts`

### Review documents

- `docs/AUT-1-DOMAIN-STORE.md`
- `docs/AUT-1-STATE-MACHINE.md`
- `docs/AUT-1-INTENT-RECEIPT-RECOVERY.md`
- `docs/AUT-1-PERSISTENCE-BOUNDARY.md`
- `docs/AUT-1-PERSISTENCE-ADR.md`
- `docs/AUT-1-STAGE-REVIEW.md`
- `docs/AUT-1-PROVENANCE.txt`
- `dist/review/AUT-1-TEST-SUMMARY.json`

## Verification matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| StepSpec/StepRuntime separation | PASS | 15 AUT-1 tests, immutable spec assertion, runtime transition/revision/currentAttempt |
| Requirement canonical truth | PASS | canonical ordering/sha, wrong sha, sensitive key, immutable replace rejection |
| Action semantic idempotency | PASS | same key replay, changed payload conflict, semantic hash schema validation, duplicate attempt snapshot rejection |
| Schema migration | PASS | explicit v0→v2, v1→v2, reopen, missing/conflict/future version fail closed |
| Checkpoint | PASS | runtime/spec matching, attempt binding, receipt graph project derivation, reopen |
| State + audit atomicity | PASS | valid/invalid transition, rollback, contiguous sequence/hash chain |
| Persistence boundary | PASS | independent `automation.db`, no V1/WebGPT adapter import, ADR recorded |
| `npm run check` | PASS | TypeScript source and test typecheck |
| `npm test` | 228/228 PASS | full local test suite |
| `npm run build` | PASS | build script and control-plane schema |
| `npm run package:win` | PASS | packaged GUI + CLI generated |
| `npm audit --omit=dev` | PASS | 0 vulnerabilities |
| `git diff --check` | PASS | no whitespace errors in scoped changes |
| scoped high-confidence secret scan | PASS | 0 credential-pattern hits in Gate Fix source/test |

## Persistence and privacy evidence

- `automation.db` is independent from V1 persistence, Native App Server, WebGPT registries and Browser profile.
- canonical payload is bounded to 32 KiB with depth/node/key/string limits and sensitive-key rejection; no Prompt/Transcript/Response/Cookie/Token/Authorization/Password/Private Key/raw body/DOM/HTML is accepted as a field.
- SHA-256 detects inconsistent canonical payloads; it is not a cryptographic signature.
- failed callback/schema/hash/reference validation preserves the previous snapshot.
- No real Native/WebGPT execution was started by this stage.

## Known limitations / accepted boundary

- JSON snapshot is a single-process single-writer foundation; it is not cross-process ACID and has no lock/CAS/writer epoch/WAL. See `AUT-1-PERSISTENCE-ADR.md`.
- v1 migration cannot recover an absent legacy requirement body; it stores an explicit legacy reference envelope and does not claim to recreate missing text.
- audit hash chain validates local continuity and tamper consistency, not author authenticity; non-state table mutation audit coverage remains a foundation limitation.
- No dispatcher, receipt reconciliation, automatic retry, Planner continuation, UI or real execution exists.
- AUT-0 remains `NOT_FROZEN` by instruction.

## Subagents

| Agent | Task | Natural completion | Result | Adopted |
| --- | --- | --- | --- | --- |
| Hilbert | schema/runtime separation and migration read-only audit | completed | identified v1→v2, strict version and runtime-reference requirements | yes |
| Galileo | RequirementVersion truth contract read-only audit | completed | identified canonical payload/hash, bounds, immutable replacement and legacy envelope requirements | yes |
| Kepler | ActionIntent semantic idempotency read-only audit | completed | identified semantic descriptor, drift conflict and duplicate-attempt protections | yes |
| Bernoulli | persistence/provenance/audit read-only audit | completed | identified single-writer ADR, dirty-file exclusion and provenance requirements | yes |

All four agents made no shared-file edits, returned naturally, were reviewed, and were closed before Gate. `running_subagents=0`.

## Provenance

```text
base_commit: 283f277c82951f92e2f3789f5a033de0e6285f17
gate_fix_commit: c777bb9c913fabd68bf6ac25d7c08f0a0a79efce
review_commit: c777bb9c913fabd68bf6ac25d7c08f0a0a79efce (code review baseline; no separate implementation review commit)
v1_core_changed: NO
webgpt_v1_changed: NO
real_native_execution_started: NO
real_webgpt_execution_started: NO
```

审查包的 SHA-256 由 `dist/review/AUT-1-STAGE-REVIEW-PACKAGE.sha256` 提供，sidecar 是权威精确值；为避免 ZIP 自包含自哈希的循环，package hash 不嵌入 ZIP 内容。

## Gate

```text
PASS_CANDIDATE; review package is prepared for user/GPT review
```
