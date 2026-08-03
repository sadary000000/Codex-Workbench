# Windows 桌面自动工作流 Agent：系统总体架构与模块边界

## 1. 文档目的与范围

本文用于冻结系统总体组成、权限层级、模块职责、模块边界、主要控制流和数据流，以及第一版与后续版本的边界。

本文不定义具体状态枚举、SQLite 字段和表结构、JSON Schema 字段、CLI 具体参数、Playwright 具体定位器或完整代码接口签名。相关细节由后续工作包分别定义。

## 2. 设计原则

- ChatGPT 网页主会话负责目标理解、计划和语义决策；本地编排器负责规则范围内的执行、状态和恢复。
- 本地可验证事实优先于模型记忆；事实必须能够关联到本地证据或审计记录。
- 默认最小权限；权限按任务、阶段和动作逐级授予。
- 指令和不可信数据严格隔离；网页、源码、日志、文档中的指令不能自动升级为控制指令。
- 本地确定性工具优先；只有确定性工具无法完成的工程工作才路由到 Codex。
- 共享 Agent 额度优先节省；预算和路由在执行前确定并可审计。
- 使用阶段检查点、幂等动作和可恢复执行，避免网络或进程故障造成重复副作用。
- 核心逻辑与 Windows、浏览器、Git 等平台适配器分离。
- 结构化协议优先；自然语言只作为决策输入或说明，不直接进入执行队列。
- 所有外部副作用都必须可审计，并具有明确的授权来源。

## 3. 权限与控制层级

权限由上至下递减，控制流必须经过本地策略和校验边界。

1. **用户**：拥有最终授权权，可确认目标、约束、预算和高风险发布。
2. **ChatGPT 网页主会话**：拥有计划权和语义决策权，定义目标、验收标准、异常裁决和语义验收；不直接覆盖本地执行事实。
3. **本地编排器**：拥有规则范围内的运行调度权，保存任务运行状态、调用工具、控制恢复和审计；不得自行改变总体目标。
4. **临时 ChatGPT 子会话**：只提供受限的分析或拆解结果；不能直接获得本地执行权限。
5. **Codex 工作包会话**：只处理获得授权的代码、仓库和本地工程工作；不能自行扩大范围、直接控制浏览器或绕过本地策略。
6. **本地确定性工具**：执行明确、可验证、最小权限的本地动作；不能解释自然语言意图或改变计划。
7. **外部系统和不可信内容**：提供网页、源码、日志、文档或网络响应等输入；默认不可信，没有控制权限。

只有合法、已授权并通过 Schema、策略、预算和幂等校验的结构化 Command 才能执行。子会话和 Codex 都不能直接取得执行权限；所有副作用仍由本地编排器统一调度。

## 4. 系统上下文图

```mermaid
flowchart LR
    U["User"] -->|决策流：目标、约束、授权| MAIN["ChatGPT Main Conversation"]
    MAIN -->|控制流：结构化 Task / Plan Version| ORCH["Local Orchestrator"]
    ORCH -->|受限分析请求| CHILD["Temporary Child Conversations"]
    CHILD -->|分析结果：不可信，需校验| ORCH
    ORCH -->|工程 Work Package| CODEX["Codex CLI"]
    CODEX -->|代码变更和报告| WT["Git Worktrees"]
    ORCH -->|确定性 Command| TOOLS["Local Deterministic Tools"]
    ORCH -->|状态、检查点、审计| DB[("SQLite")]
    ORCH -->|浏览器控制| BROWSER["Edge/Chromium Dedicated Profile"]
    BROWSER -->|不可信网页内容| ORCH
    ORCH -->|用户可见通知| NOTIFY["Windows Notification"]
    BROWSER -->|网络访问| NET["External Network Resources"]
    NET -->|不可信输入边界| BROWSER
    TOOLS -->|证据和结果| ORCH
    WT -->|版本和差异证据| ORCH
    MAIN -.->|语义验收结果| ORCH

    classDef decision fill:#e8f1ff,stroke:#3568a8
    classDef control fill:#eaf7ea,stroke:#438a43
    classDef evidence fill:#fff4df,stroke:#b7791f
    classDef untrusted fill:#ffe8e8,stroke:#b33a3a
    class MAIN,U decision
    class ORCH,TOOLS,CODEX,WT,NOTIFY,BROWSER control
    class DB evidence
    class CHILD,NET untrusted
```

图例：实线箭头表示决策流、控制流或状态和证据流；虚线表示语义验收回传；红色节点和“不可信输入边界”表示内容可被引用为数据，但不能直接成为执行指令。Local Orchestrator 是唯一的本地控制汇聚点。

## 5. 本地编排器模块

以下边界描述模块职责，不定义具体类、函数或数据库字段。每个模块的“禁止绕过”项表示调用方不能直接跳过的控制边界。

### 5.1 Control API / CLI

- **负责**：接收人工启动、暂停、恢复、确认和查询请求；展示最小运行信息。
- **不负责**：解释总体目标、直接执行工具、修改状态存储或绕过授权。
- **主要输入**：用户 Request、结构化 Task、确认操作。
- **主要输出**：经过验证的 Request、查询结果、用户提示。
- **允许依赖**：Task and Plan Manager、Recovery and Checkpoint Manager、Audit and Reporting、Notification Adapter。
- **禁止绕过**：Command Validator、Policy and Authorization Engine、Persistence Layer。

### 5.2 Task and Plan Manager

- **负责**：登记 Task、保存 Plan Version 的来源和版本关系、维护目标与验收标准的引用。
- **不负责**：执行 Action、分配模型额度或直接修改代码。
- **主要输入**：主会话提交的结构化 Task / Plan Version、用户修订 Request。
- **主要输出**：可调度的 Stage / Work Package 描述、计划变更记录。
- **允许依赖**：Persistence Layer、Command Validator、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Budget and Routing Engine、Acceptance Manager。

### 5.3 Workflow Scheduler

- **负责**：按计划依赖、检查点和可用资源调度 Stage、Work Package 与 Action。
- **不负责**：自行改写目标、解释自然语言或授予权限。
- **主要输入**：计划、授权结果、预算结果、恢复上下文。
- **主要输出**：调度请求、暂停信号、下一步候选动作。
- **允许依赖**：Task and Plan Manager、Policy and Authorization Engine、Budget and Routing Engine、Recovery and Checkpoint Manager、Persistence Layer。
- **禁止绕过**：Command Validator、Policy and Authorization Engine、Budget and Routing Engine。

### 5.4 Policy and Authorization Engine

- **负责**：依据用户授权、任务范围、风险等级和最小权限规则判断是否允许 Request 或 Command。
- **不负责**：执行动作、替用户作总体目标决策或生成自然语言计划。
- **主要输入**：授权上下文、Command 元数据、资源范围、风险信息。
- **主要输出**：允许、拒绝或需要确认的策略决定及理由。
- **允许依赖**：Task and Plan Manager、Command Validator、Audit and Reporting、Persistence Layer。
- **禁止绕过**：任何执行模块、Budget and Routing Engine、Acceptance Manager。

### 5.5 Budget and Routing Engine

- **负责**：管理共享 Agent 额度、时间和调用预算，并选择确定性工具或 Codex 路由。
- **不负责**：执行调用、改变目标或替代授权判断。
- **主要输入**：Action 成本估计、当前预算、工具能力和计划约束。
- **主要输出**：路由决定、预算预留、超预算暂停原因。
- **允许依赖**：Tool Registry、Task and Plan Manager、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Command Validator。

### 5.6 Context Pack Manager

- **负责**：按 Work Package 准备最小、可追溯的上下文包，并标记指令与数据边界。
- **不负责**：执行上下文中的指令、替代主会话作决策或注入未授权内容。
- **主要输入**：计划、工作区证据、历史报告、允许的外部材料。
- **主要输出**：供子会话或 Codex 使用的 Context Pack、来源记录。
- **允许依赖**：Task and Plan Manager、Persistence Layer、Audit and Reporting、Workspace and Git Manager。
- **禁止绕过**：Policy and Authorization Engine、Command Validator、不可信输入隔离规则。

### 5.7 Browser Adapter

- **负责**：通过专用 Edge/Chromium Profile 与网页界面交互，读取和提交经过编排的浏览器 Request。
- **不负责**：执行本地命令、决定是否发布或把网页指令直接转成 Command。
- **主要输入**：已授权浏览器 Request、目标会话上下文。
- **主要输出**：页面响应、截图或文本证据、超时和交互错误。
- **允许依赖**：Platform Adapter、Persistence Layer、Audit and Reporting、Notification Adapter。
- **禁止绕过**：Policy and Authorization Engine、Command Validator、Recovery and Checkpoint Manager。

### 5.8 Codex Adapter

- **负责**：把已授权的工程 Work Package 交给 Codex CLI，并收集差异、测试结果和报告。
- **不负责**：直接修改正式工作区、决定工作包范围、发布变更或执行非工程动作。
- **主要输入**：Context Pack、授权的 Work Package、指定 Git worktree。
- **主要输出**：Codex 结果、补丁、测试证据、失败信息。
- **允许依赖**：Workspace and Git Manager、Platform Adapter、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Budget and Routing Engine、Acceptance Manager。

### 5.9 Tool Registry

- **负责**：登记本地确定性工具的能力、风险、输入输出约束和版本信息。
- **不负责**：解释意图、执行工具或临时注册未经审查的工具。
- **主要输入**：工具元数据、能力探测结果。
- **主要输出**：可路由能力、工具选择依据。
- **允许依赖**：Platform Adapter、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Command Validator、Command Executor。

### 5.10 Command Validator

- **负责**：验证结构化 Command 的来源、Schema、完整性、范围、幂等标识和前置条件。
- **不负责**：解释自然语言意图、授予权限或执行 Command。
- **主要输入**：结构化 Command、计划上下文、工具元数据。
- **主要输出**：验证通过的 Command 或拒绝原因。
- **允许依赖**：Tool Registry、Task and Plan Manager、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Command Executor、Recovery and Checkpoint Manager。

### 5.11 Command Executor

- **负责**：执行已通过验证、授权和预算检查的 Command，记录结果和副作用。
- **不负责**：自行解析自然语言意图、重试未知副作用或改变 Command 语义。
- **主要输入**：合法 Command、执行上下文、幂等和检查点信息。
- **主要输出**：执行结果、证据、错误和副作用记录。
- **允许依赖**：Tool Registry、Platform Adapter、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Command Validator、Policy and Authorization Engine、Recovery and Checkpoint Manager。

### 5.12 Workspace and Git Manager

- **负责**：创建任务 worktree、隔离工作目录、收集差异、管理本地 Git 版本证据。
- **不负责**：决定代码是否正确、直接替正式原项目发布或代替 Acceptance Manager 验收。
- **主要输入**：Work Package、仓库路径、分支和版本约束。
- **主要输出**：worktree、版本差异、提交和清理结果。
- **允许依赖**：Platform Adapter、Persistence Layer、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Acceptance Manager、Workspace 范围限制。

### 5.13 Acceptance Manager

- **负责**：组织本地机器验收、收集验收证据，并准备提交主会话进行语义验收的材料。
- **不负责**：替主会话作最终语义裁决、修改实现或自动扩大验收范围。
- **主要输入**：工具结果、Codex 差异、测试证据、验收标准。
- **主要输出**：机器验收报告、待主会话裁决的语义验收包、通过或返工建议。
- **允许依赖**：Task and Plan Manager、Workspace and Git Manager、Persistence Layer、Audit and Reporting、Browser Adapter。
- **禁止绕过**：Policy and Authorization Engine、Command Validator、用户最终确认。

### 5.14 Recovery and Checkpoint Manager

- **负责**：在阶段边界保存检查点，识别可重放、可恢复和必须暂停的情况。
- **不负责**：隐式重试有副作用的请求、修改目标或掩盖失败。
- **主要输入**：执行结果、超时、进程状态、幂等信息和人工恢复 Request。
- **主要输出**：暂停、恢复、重新规划建议和检查点上下文。
- **允许依赖**：Persistence Layer、Workflow Scheduler、Audit and Reporting、Notification Adapter。
- **禁止绕过**：Policy and Authorization Engine、Budget and Routing Engine、Command Validator。

### 5.15 Persistence Layer

- **负责**：提供任务运行状态、检查点、预算、授权引用和审计数据的持久化抽象。
- **不负责**：保存代码版本、执行命令或决定状态迁移语义。
- **主要输入**：编排器产生的结构化运行记录。
- **主要输出**：可靠读取、写入和查询结果。
- **允许依赖**：Platform Adapter。
- **禁止绕过**：Audit and Reporting、Recovery and Checkpoint Manager 的一致性规则；不得被直接当作代码版本库。

### 5.16 Audit and Reporting

- **负责**：汇总请求、授权、路由、执行、证据、验收和副作用，生成可追溯报告。
- **不负责**：修改运行状态、批准动作或发送未授权外部消息。
- **主要输入**：各模块结构化事件、执行证据和验收结果。
- **主要输出**：审计记录、运行报告、供主会话和用户阅读的摘要。
- **允许依赖**：Persistence Layer、Platform Adapter。
- **禁止绕过**：所有产生副作用的模块必须写入审计；不得以报告代替授权。

### 5.17 Notification Adapter

- **负责**：通过 Windows 桌面通知告知暂停、需要确认、失败和完成等运行事件。
- **不负责**：承担任务决策、修改授权或确认高风险动作。
- **主要输入**：经审计的通知事件、用户可见摘要。
- **主要输出**：Windows Notification、通知投递结果。
- **允许依赖**：Platform Adapter、Audit and Reporting。
- **禁止绕过**：Policy and Authorization Engine、Control API / CLI 的确认流程。

### 5.18 Platform Adapter

- **负责**：封装 Windows 进程、文件系统、通知、浏览器启动和本地环境差异。
- **不负责**：承载业务策略、解释 Task 或决定是否执行。
- **主要输入**：经过上层授权的低级平台请求。
- **主要输出**：平台结果、能力和错误信息。
- **允许依赖**：仅依赖受控的 Windows 平台能力和必要的本地运行时。
- **禁止绕过**：Command Validator、Policy and Authorization Engine、Audit and Reporting；不得成为隐藏执行入口。

## 6. 关键边界规则

- Browser Adapter 不能直接执行本地命令。
- Codex Adapter 不能直接修改正式工作区，只能在授权的任务 worktree 中工作。
- Command Executor 不能自行解析自然语言意图。
- 所有 Command 必须经过 Command Validator 和 Policy and Authorization Engine。
- Workflow Scheduler 不能绕过预算和授权。
- SQLite 是任务运行状态来源，但不是代码版本来源。
- Git 负责文件版本，SQLite 负责任务运行状态。
- ChatGPT 不能直接覆盖本地执行事实；它只能基于本地报告进行语义裁决。
- 临时子会话不能直接和 Codex 互相调用，二者的交互必须经本地编排器和授权上下文。
- Notification Adapter 不能承担任务决策。
- 外部网络资源不能直接进入执行队列，必须先作为不可信输入隔离、提取、校验并获得授权。

## 7. 核心运行流程

```mermaid
sequenceDiagram
    actor User
    participant Main as ChatGPT Main Conversation
    participant O as Local Orchestrator
    participant V as Command Validator
    participant P as Policy and Authorization Engine
    participant B as Budget and Routing Engine
    participant C as Checkpoint Manager
    participant T as Deterministic Tools / Codex
    participant A as Acceptance Manager
    participant DB as SQLite / Audit

    User->>Main: 提出目标、约束和验收标准
    Main->>O: 结构化 Task 与 Plan Version
    O->>V: 校验来源、Schema、范围和幂等信息
    V-->>O: 校验结果
    O->>P: 请求授权判断
    P-->>O: 授权或需要用户确认
    O->>B: 请求预算预留和路由
    B-->>O: 确定性工具或 Codex 路由
    O->>C: 创建工作区及检查点
    C->>DB: 保存运行上下文
    O->>T: 调度已授权 Action
    T-->>O: 结果、证据或错误
    O->>C: 保存结果和恢复信息
    C->>DB: 持久化检查点与审计
    O->>A: 发起本地机器验收
    A-->>O: 验收证据和报告
    O->>Main: 提交语义验收材料
    Main-->>O: 通过、有限返工或重新规划决定
    alt 需要有限返工
        O->>P: 重新校验返工范围
        O->>T: 调度受限返工 Action
    else 发布或等待确认
        O->>User: 请求最终确认或等待确认
    end
    O->>DB: 归档运行状态和审计报告
```

主流程是：用户提出目标 → ChatGPT 生成计划 → 本地接收结构化任务 → 校验授权、Schema 和预算 → 创建工作区及检查点 → 调度确定性工具或 Codex → 本地机器验收 → ChatGPT 语义验收 → 必要时有限返工 → 发布或等待确认 → 归档和审计报告。

失败时，编排器依据检查点和幂等信息进入暂停或恢复路径；如果目标、约束或验收标准发生变化，则暂停当前运行并请求主会话重新规划。网络超时只记录为未决结果，不得直接重复发送；是否重试必须依据动作幂等性、服务端确认和新的授权判断。高风险发布采用两阶段提交：先准备并生成完整证据，再在用户明确确认后执行提交或发布。

## 8. 运行部署拓扑

### 8.1 第一版设计目标

- Windows 10。
- Node.js + TypeScript CLI。
- SQLite 本地数据库，用于任务运行状态、检查点和审计数据。
- 独立 Edge/Chromium 持久化 Profile。
- 本地 Git 仓库和任务 worktree。
- Windows 桌面通知。
- 人工启动，以及人工在 ChatGPT 与本地编排器/Codex 之间传递信息。

第一版不包含 Playwright 自动控制主会话、系统托盘、Windows 服务、开机恢复、定时和事件触发器或 GUI；这些属于后续版本候选能力。

### 8.2 后续版本候选

- Playwright 自动控制主会话。
- 系统托盘和可选 GUI。
- Windows 服务与开机恢复。
- 定时和事件触发器。

这些能力在本阶段只作为边界记录，不代表已经实现或已纳入第一版主链。

## 9. MVP 边界

第一版设计目标是一个小型、可复现的 Python 项目，用于同时验证确定性工具和一次强制 Codex 调用，并支持状态保存、暂停、恢复、幂等和审计。代码工作必须在隔离的任务 worktree 中进行，不允许直接修改稳定原项目。

第一版不实现 Work 集成、完整 GUI、系统级自动安装、数据库整体加密、自动发送邮件或公开发布。高风险发布只保留人工确认边界，不作为无人值守能力。

## 10. 非目标

- 通用 RPA 平台。
- 任意网页自动化。
- 无限制自主系统。
- 绕过登录、验证码和权限控制。
- 无限制自我修改。
- 第一版跨平台支持。
- 第一版处理高风险系统管理操作。

## 11. 架构决策记录

| 决策 | 选择方案 | 主要理由 | 被放弃方案 | 后续复审条件 |
|---|---|---|---|---|
| 最高决策层 | ChatGPT 网页主会话 | 保留目标、约束和语义验收的统一来源 | 由本地 Agent 自行改变总体目标 | 主会话接口或人工交互模式发生变化时复审 |
| 运行控制层 | 本地 Node.js + TypeScript 编排器 | 可保存状态、执行本地工具、管理恢复和审计 | 由浏览器会话直接驱动本地副作用 | 需要无人值守部署或跨机器调度时复审 |
| 工具路由 | 本地确定性工具优先，工程工作路由 Codex | 节省共享额度并提高可复现性 | 所有任务默认调用 Agent | 工具能力覆盖率或预算模型发生变化时复审 |
| 代码隔离 | 任务 Git worktree | 降低稳定原项目被直接修改的风险 | 直接在稳定原项目工作区修改 | 需要不同版本控制后端时复审 |
| 状态与版本 | SQLite 保存运行状态，Git 保存文件版本 | 分离运行事实与代码历史 | 用 Git 保存运行状态或用 SQLite 保存代码版本 | 分布式运行或代码托管要求变化时复审 |
| 第一版交互 | 人工启动和人工传递信息 | 当前尚未实现 Agent，便于逐步验证边界 | 第一版自动控制主会话 | Playwright、托盘或服务方案完成安全评估后复审 |

### 待 GPT 决策

- 第一版主会话与本地编排器之间采用哪一种具体人工传递载体，待 GPT 在协议工作包中确认。
- 高风险发布的具体动作分类和确认文案，待 GPT 结合安全模型和 MVP 验收标准确认。
- 后续自动控制主会话的浏览器会话隔离和登录凭据策略，待 GPT 在后续工作包中确认。
