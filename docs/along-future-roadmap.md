# Along 未来愿景与路线图

## 1. 背景

`packages/along` 最初是为了解决通过 agent editor 开发时的几个问题：

- 手机上通过终端输入和观察任务状态体验差。
- 会话数据散落在不同 IDE、终端和工具中，难以沉淀为项目资产。
- 用户希望只提出一个问题，系统就能自动推进到生产交付，并在过程中通过计划、评审、CI、修复和发布控制保证质量。

当前 `along` 已经具备 GitHub Issue、session、worktree、PR、CI、review 和 webhook 编排能力，但新的问题也很明显：

- GitHub Issue 列表不适合作为高频会话管理界面。
- 复杂方案需要多轮讨论和收敛，单纯依赖 Issue 评论体验较弱。
- 未来需要多 Agent 协作、专属人格、长期记忆和阶段化职责，而不仅是自动跑一个 coding agent。

本文档记录当前讨论形成的产品判断和大致路线图。它不是实现规格，也不要求一次性完成。

## 2. 核心定位

`along` 不应该演化成 Linear、GitHub Issue 或 Cursor 的替代品。

更准确的定位是：

> Along 是 AI 交付运行时，负责把一个问题可靠推进到可验证、可审查、可上线的代码交付结果。

外部工具的边界如下：

| 系统 | 适合承担 | 不应承担 |
|---|---|---|
| GitHub | repo、branch、commit、PR、CI、review、merge、交付事实记录 | 高频会话入口、复杂方案讨论主界面 |
| Linear | 需求池、优先级、roadmap、项目管理、跨团队协作、任务状态 | agent 执行、worktree、代码质量门禁、CI 修复、部署闭环 |
| Along | agent 工作流、计划审批、实现、评审、测试、CI 修复、发布、记忆沉淀 | 通用任务管理、项目管理、替代 Linear/GitHub |

如果只是把 Linear 当成另一个评论区，它和直接操作 GitHub 的区别不大。真正有价值的路线是：Linear/GitHub 作为外部入口和事实记录，`along` 作为背后的 AI 交付系统。

## 3. 目标体验

长期目标是：

> 用户只需要提出一个问题，系统自动判断任务复杂度，选择合适的工作流，调用多个有职责、有性格、有记忆的 Agent，产出可审批计划，执行到 PR、CI、review、上线，并把过程沉淀成项目记忆。

典型任务可能分为：

- 简单任务：AI 输出方案后直接实现，验证通过后开 PR 或上线。
- 标准任务：先形成 Plan，等待人工 approve，再进入实现。
- 复杂任务：多个不同立场的 Agent 分别提出方案，由合成 Agent 产出终版 Plan。
- 高风险任务：加强架构评审、安全评审、测试评审和发布回滚检查。
- 研究任务：只调研和沉淀结论，不写代码。

## 4. 关键原则

### 4.1 不做通用任务管理

凡是属于“人如何管理任务、优先级、项目、团队状态”的能力，优先交给 Linear 或 GitHub。

`along` 应聚焦在“AI 如何可靠交付代码和知识资产”。

### 4.2 不把 GitHub Issue 当主会话模型

GitHub Issue 可以继续作为外部事件源和审计记录，但内部应逐步从 `issueNumber` 转向 `taskId/threadId`。

Issue、Linear Issue、PR、commit、CI run 都应该是 `Artifact`，不是系统核心实体。

### 4.3 Agent 必须产出结构化 artifact

不要做无边界的多 Agent 聊天室。每个 Agent 都必须输出可验证、可比较、可进入下一阶段的结构化结果。

候选 artifact 包括：

- `proposal`
- `objection`
- `decision`
- `plan_revision`
- `review_finding`
- `fix_attempt`
- `release_note`
- `memory_candidate`

工作流引擎根据 artifact 决定下一步，而不是让 Agent 无限对话。

### 4.4 性格不是人设，而是取舍函数

Agent 的性格定义为：

> Agent 在不确定性下的默认取舍函数。

它应稳定影响 Agent 如何判断风险、如何质疑需求、如何沟通、是否阻塞、如何处理冲突。

性格必须服务于职责和流程契约，不能凌驾于工作流。

### 4.5 记忆必须可追溯

记忆不是聊天历史的堆积。记忆必须有来源、作用域、可信度、更新时间和人工确认状态。

默认只有经过确认的长期记忆才能进入高优先级上下文，避免一次临时讨论污染长期规则。

## 5. 目标架构

长期可以分为四层：

### 5.1 任务入口层

统一接收来自不同入口的任务：

- `along-web`
- Linear
- GitHub Issue
- GitHub PR
- CLI
- 手机端输入
- webhook

入口层只负责收集输入，并转换成内部 `Task`。

### 5.2 工作流编排层

根据任务类型、风险、影响范围和用户偏好选择 workflow profile：

| Profile | 用途 | 人工参与 |
|---|---|---|
| `fast` | 简单、低风险任务，计划后直接实现 | 默认不阻塞 |
| `standard` | 常规任务，先 Plan 后实现 | Plan 需要 approve |
| `council` | 复杂或高风险任务，多 Agent 出方案并合成终版 | Plan 需要 approve |
| `hotfix` | 紧急修复，缩短讨论但加强验证和回滚 | 可后补 review |
| `research` | 调研、解释、方案比较，不写代码 | 输出结论 |

编排层负责阶段流转、并发控制、artifact 收集、投票或裁决、失败恢复。

### 5.3 Agent 运行层

每个阶段由专属 Agent 承担明确职责。

Planning 阶段示例：

| Agent | 职责 | 默认性格 |
|---|---|---|
| Product Realist | 判断业务价值、用户路径和需求是否成立 | 现实、追问价值、反对无效需求 |
| Architect Skeptic | 挑架构风险、边界污染、长期债务 | 保守、质疑、阻塞高风险方案 |
| Implementation Pragmatist | 判断实现路径、改动成本、测试面和上线风险 | 务实、关注可落地性 |
| Synthesizer | 合成终版计划，裁决冲突，输出 Plan vN | 中立、结构化、以证据为准 |

CR 阶段示例：

| Agent | 职责 | 默认性格 |
|---|---|---|
| Correctness Reviewer | 行为正确性、边界条件、回归风险 | 严格、证据优先 |
| Architecture Reviewer | 模块边界、抽象、维护性 | 保守、反对临时补丁 |
| Testing Reviewer | 测试覆盖、断言质量、验证策略 | 挑剔、关注真实风险 |
| Security Reviewer | 权限、数据泄漏、注入、供应链 | 高阻塞阈值 |
| Release Reviewer | 上线、回滚、兼容、监控 | 稳健、关注生产风险 |

### 5.4 记忆与证据层

记忆分为：

| Scope | 含义 | 示例 |
|---|---|---|
| `global` | 用户长期偏好和质量原则 | 不接受绕过类型系统，不接受糊弄式修复 |
| `project` | 项目架构、业务规则、模块边界 | 某模块的领域规则、历史 ADR |
| `task` | 当前任务的讨论、Plan、决策和反对意见 | Plan v2 接受了哪些约束 |
| `agent` | 某类 Agent 的经验和倾向 | Security Reviewer 曾在某类接口发现权限风险 |

建议记忆结构：

```ts
interface Memory {
  id: string;
  scope: 'global' | 'project' | 'task' | 'agent';
  type: 'preference' | 'architecture' | 'business-rule' | 'decision' | 'lesson';
  content: string;
  sourceArtifactId: string;
  confidence: number;
  createdBy: string;
  reviewedByHuman: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
```

记忆写入应遵循：

- Agent 只能提出 `memory_candidate`。
- 重要长期记忆需要人工确认。
- 记忆必须能追溯到任务、PR、评论、review finding 或决策记录。
- 过期或冲突的记忆必须能被降权或废弃。

## 6. Agent 性格模型

每个 Agent 至少应包含以下配置：

```yaml
agent:
  id: architect-skeptic
  role: planning_reviewer
  personality:
    stance: "保守、质疑、重视长期一致性"
    riskTolerance: low
    challengeLevel: high
    communicationStyle: "直接指出问题，少寒暄"
    decisionBias:
      - "优先维护模块边界"
      - "反对临时兼容层"
      - "发现需求不成立时必须阻塞"
  memory:
    scopes:
      - project
      - agent
  tools:
    canReadCode: true
    canWriteCode: false
    canComment: true
  outputContract: proposal_objection
```

性格应影响：

- 默认乐观还是保守。
- 更重视上线速度还是长期架构。
- 是否主动质疑需求。
- 发现风险时是阻塞还是提醒。
- 对证据的要求有多高。
- 是否接受技术债。
- 如何处理与其他 Agent 的冲突。

但性格不能破坏流程契约。例如，Architect Skeptic 可以强烈反对，但必须输出结构化 objection：

```ts
interface Objection {
  severity: 'blocking' | 'warning' | 'note';
  claim: string;
  evidence: string[];
  suggestedChange: string;
}
```

Synthesizer 再基于规则裁决：

- `blocking` 必须解决或显式驳回。
- `warning` 进入 Risks 或 Validation。
- `note` 可进入 Decision Log。
- 多个 Agent 冲突时，按 workflow profile 调整权重。

## 7. 建议数据模型演进

当前系统强绑定 GitHub Issue。未来应逐步演进为：

```ts
interface Task {
  id: string;
  title: string;
  source: 'along-web' | 'github' | 'linear' | 'cli' | 'webhook';
  sourceRef?: ExternalRef;
  profile: 'fast' | 'standard' | 'council' | 'hotfix' | 'research';
  status: string;
  createdAt: string;
}

interface Thread {
  id: string;
  taskId: string;
  purpose: 'planning' | 'implementation' | 'review' | 'release' | 'research';
  currentArtifactId?: string;
}

interface AgentRun {
  id: string;
  taskId: string;
  threadId: string;
  agentId: string;
  phase: string;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  status: string;
}

interface Artifact {
  id: string;
  taskId: string;
  type: string;
  externalRef?: ExternalRef;
  body: string;
  createdBy: string;
  createdAt: string;
}
```

GitHub Issue、Linear Issue、PR、commit、CI run 都应作为 `ExternalRef` 或 `Artifact` 关联。

## 8. 路线图

### Phase 0: 稳定现有闭环

目标：让当前 GitHub Issue 模式下的 planning 讨论先可靠工作。

重点：

- 修复“围绕某个方案持续讨论直到完全可行”的 bug。
- 确保 `Plan vN -> feedback -> DiscussionRound -> Planning Update/Plan vN+1 -> approve` 稳定。
- 确保 `approve` 只批准当前有效计划。
- 增强 planning 状态和失败诊断。

判断标准：

- 一个复杂 Issue 能稳定经历多轮讨论并最终进入 implementation。

### Phase 1: 做 Task/Thread 抽象

目标：内部不再把 GitHub Issue 当核心实体。

重点：

- 引入 `Task`、`Thread`、`Artifact` 概念。
- 保留 GitHub Issue 作为外部入口和记录。
- `along-web` 以 thread 视角展示会话，而不是以 issue list 为中心。
- 手机端可以直接输入问题并创建任务。

判断标准：

- 不依赖先创建 GitHub Issue，也能启动一个完整 planning thread。

### Phase 2: 引入 workflow profile

目标：不同复杂度任务走不同流程。

重点：

- 支持 `fast`、`standard`、`council` 三类最小 profile。
- 简单任务可以计划后自动开干。
- 标准任务需要人工 approve。
- 复杂任务进入多 Agent planning。

判断标准：

- 系统能基于任务特征或用户选择进入不同 workflow。

### Phase 3: Plan Council

目标：多 Agent 在 planning 阶段形成高质量终版方案。

重点：

- 引入 Product Realist、Architect Skeptic、Implementation Pragmatist。
- 每个 Agent 产出结构化 proposal/objection。
- Synthesizer 合成 Plan vN。
- 冲突必须进入 Decision Log。

判断标准：

- 复杂任务可以看到不同立场的意见，终版计划能说明接受和拒绝了什么。

### Phase 4: 多角色 CR

目标：PR 后由多个 Reviewer Agent 按职责审查。

重点：

- Correctness、Architecture、Testing、Security、Release 多角色 review。
- finding 去重、排序、阻塞等级判定。
- Fixer Agent 根据结构化 finding 修复。
- 修复后可重新触发 review。

判断标准：

- CR 结果比单 Agent review 更稳定、更少重复、更有阻塞语义。

### Phase 5: 项目记忆

目标：让任务经验能变成后续任务质量提升。

重点：

- 先做 `project memory`，不要先做全局大脑。
- 从 Plan、Decision Log、Review Finding、CI Failure 中提取 `memory_candidate`。
- 人工确认后写入长期项目记忆。
- planning 和 review 阶段自动检索相关记忆。

判断标准：

- 后续任务能主动引用历史架构决策、业务规则和常见风险。

### Phase 6: 全局记忆与 Agent 记忆

目标：形成稳定的个人偏好和 Agent 经验。

重点：

- 全局质量原则和沟通偏好。
- 不同 Agent 的长期倾向和经验。
- 记忆冲突、过期、降权机制。

判断标准：

- Agent 在不同项目中仍保持稳定风格，但不会把某个项目的规则错误迁移到其他项目。

## 9. 最近最应该做的事

短期不要直接做完整多 Agent 平台。建议先做三件事：

1. 修复现有 planning 多轮讨论闭环。
2. 把 `along-web` 从 session/issue 列表升级为 thread 视图。
3. 设计最小 `Task/Thread/Artifact` 抽象，但先不迁移全部历史数据。

完成这三步后，再决定是否接 Linear 作为任务入口。

## 10. 非目标

近期不做：

- 完整替代 Linear 的项目管理功能。
- 完整替代 GitHub 的 PR/CI/review 体验。
- 无限制多 Agent 聊天室。
- 没有来源和确认机制的长期记忆。
- 只靠 prompt 约束的关键流程状态管理。

## 11. 一句话总结

`along` 的长期方向不是“更好用的 GitHub Issue 管理器”，也不是“自建 Linear”。

它应该成为一个有工作流、有 Agent 职责、有 Agent 性格、有记忆、有质量门禁的 AI 交付运行时。
