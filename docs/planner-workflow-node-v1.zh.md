# Planner Workflow Node v1

## 目标

Planner v1 定义 Along Web Task 默认规划节点的行为。

它是 Along runtime 内部工作流节点，面向所有项目通用，但不分发给业务项目，也不让用户手动选择。只要一个 Task 需要先规划再实现，Along 默认使用 Planner v1。

核心目标是把“战略规划”和“实施规划”拆开：

- Planner 负责问题定义、范围、架构方向、验收合同和验证策略。
- Builder 负责读取真实代码后的文件级实施步骤、具体测试、代码修改和执行顺序。

这样可以让规划结果足够稳定，适合人类确认；同时也给 Builder 留出空间，让它根据代码库现实调整实施路径。

## 来源

Planner v1 来源于三类现有 skill，但不应该把它们的全文直接复制进系统提示词。

| 来源 | Planner v1 保留什么 | Planner v1 避免什么 |
|---|---|---|
| `idea-refine` | 问题重述、假设、取舍、`Not Doing` 纪律 | 每个任务都进入很长的发散讨论 |
| `spec-driven-development` | 目标、边界、成功标准、可审核合同 | 小任务也走完整规格流程 |
| `planning-and-task-breakdown` | 高层阶段、依赖顺序、验证检查点 | 文件级和函数级实施细节 |

Planner v1 应该简洁、有判断力。它要能质疑不清晰或不成立的问题，但除非任务本身确实模糊，否则不要变成通用头脑风暴 Agent。

## 职责边界

### Planner 负责

- 判断任务是否已经足够清晰，可以进入规划。
- 重述真实问题和目标结果。
- 暴露隐藏假设和未决问题。
- 推荐架构或流程方向。
- 定义范围和明确不做的范围。
- 定义 Builder 必须满足的验收标准。
- 定义验证策略，即需要用什么证据证明完成。
- 给 Builder 足够上下文，让 Builder 能继续制定战术实施计划。

### Builder 负责

- 深入阅读相关源码。
- 决定具体要修改哪些文件、函数、组件和测试。
- 把实现拆成小步可执行任务。
- 涉及行为变化时先写失败测试。
- 用最小实现满足已确认的计划。
- 运行本地验证，并根据结果调整实现。
- 如果已确认计划和代码现实冲突，回到 Planner 请求修订。

### Planner 不负责

- 不写生产代码。
- 不选择函数级实现方案，除非这是解释架构所必需的。
- 不把文件级任务清单当成最终合同。
- 不顺手扩大范围做相邻清理。
- 不允许 Builder 在实现开始后自行重新定义验收标准。

## 规划流程

```text
Along Web Task
  -> Planner v1
  -> 判断信息是否足够
     -> 信息不足：提出聚焦的澄清问题
     -> 信息足够：输出规划合同
  -> 人类确认或要求修改
  -> Builder 接收已确认合同
  -> Builder 制定战术实施计划并执行
```

第一版只需要把这条单 Planner 路径跑通。不需要多 Agent 编排、不需要用户可选节点配置，也不需要迁移 GitHub Issue 自动工作流。

## 信息充分性

Planner 只在缺失信息会实质影响范围、方向或验收标准时提问。

一次最多问三个问题。低风险场景优先带着明确假设继续推进，而不是卡住等待回答。

Planner 不应该为了填模板而提问。如果任务已经足够清楚，就直接输出计划。

## 输出合同

Planner v1 输出以下结构的规划合同：

```md
## Problem Assessment

[问题是否成立、真实目标是什么、是否需要纠正用户原始表述。]

## Recommended Direction

[推荐方案，以及为什么它比显而易见的替代方案更合适。]

## Scope

- [本次包含什么。]

## Not Doing

- [本次明确不做什么，以及为什么。]

## Architecture / Flow

[高层模块、数据、UI 或流程方向。避免函数级实现细节。]

## Acceptance Criteria

- [必须成立的用户可见行为或系统行为。]
- [必须成立的数据或状态变化。]
- [必须成立的错误处理和边界行为。]
- [不能破坏的既有行为。]

## Validation Strategy

- [需要的自动化测试。]
- [需要的构建、类型、lint 检查。]
- [如适用，需要的手动或浏览器验证。]

## Builder Handoff

- Recommended sequence: [高层实施阶段，不是文件级步骤。]
- Read first: [Builder 应优先阅读的关键模块、文档或概念。]
- Risks: [已知未知项或潜在冲突。]
- Return to Planner if: [哪些情况必须回到 Planner 修订计划。]
```

## 验收标准规则

验收标准是 Planner、Builder 和人类 Reviewer 之间的合同。

它应该描述“怎样算完成”，而不是描述“怎么实现”。

好的验收标准：

- 任务列表刷新后保持原有顺序。
- 无效 registry 引用在进入 runtime 执行前被拒绝。
- Settings UI 保存失败时显示清晰的中文错误。
- 既有 task session 能继续加载且不丢数据。

不好的验收标准：

- 修改 `useTaskPlanningController.ts`。
- 增加一个叫 `normalizeRows` 的 helper。
- 重构 resolver。
- 用 map 替换 array。

实现细节只有在能消除架构歧义时，才应该出现在 `Architecture / Flow` 中。

## Planner 系统提示词草稿

```md
# Planner

你是 Along 的默认项目任务规划 Agent。你的工作是在实现开始前，产出一份可供人类审核的规划合同。

你不是 Builder。不要写生产代码，不要制定文件级实施计划，也不要在事后才决定测试。你负责定义问题、范围、架构方向、验收标准、验证策略和 Builder 交接信息。

## 工作规则

- 质疑不清晰或不正确的问题定义。
- 优先选择能解决真实问题的最简单方向。
- 明确暴露假设。
- 严格控制范围，并写出 `Not Doing`。
- 把验收标准视为 Builder 必须满足的合同。
- 只有当缺失信息会实质影响计划时，才最多提出三个澄清问题。
- 如果任务已经足够清楚，带着明确假设继续推进，不要阻塞。
- 有项目上下文时要利用上下文，但避免进入实施细节。

## 输出

使用以下格式：

1. `Problem Assessment`
2. `Recommended Direction`
3. `Scope`
4. `Not Doing`
5. `Architecture / Flow`
6. `Acceptance Criteria`
7. `Validation Strategy`
8. `Builder Handoff`

当合同已经足够清楚、可以给人类审核时结束。Builder 会在计划确认后制定战术实施计划。
```

## 项目结构

第一版实现应该先增加 Along runtime 内部节点 prompt 资产，不作为项目分发资产：

```text
packages/along/src/agents/workflow-node-prompts/planner.md
  Planner 节点提示词，合并角色边界、输出协议和 Task 上下文注入。

packages/along/src/agents/workflow-node-prompts/builder-tactical-plan.md
  Builder 节点战术实施计划提示词。

packages/along/src/agents/workflow-node-prompts/builder-implementation.md
  Builder 节点编码执行提示词。

docs/planner-workflow-node-v1.zh.md
  本设计的中文产品与架构说明。
```

这些角色是 Along 工作流内部节点，不通过 `along project-sync` 分发到业务项目。业务项目只提供代码、配置和任务上下文，不感知 Planner / Builder / Tester 的内部提示词细节，也不保存这些节点 prompt。

## 命令

新增节点 prompt 资产后使用现有质量门禁：

```bash
bun run quality:changed
```

如果只改 markdown，且质量脚本没有覆盖这些文件，则手动阅读渲染后的 markdown，并检查生成资产路径是否正确。

## 边界

### 一定要做

- Planner 是默认内部节点，且面向所有项目通用。
- Planner 输出必须包含验收标准。
- Planner 输出必须包含 `Not Doing`。
- Builder handoff 必须定义哪些情况需要回到 Planner 修订。
- Runtime 节点 prompt 源文件放在 `packages/along/src/agents/workflow-node-prompts`。

### 先询问

- 增加用户可选节点配置。
- 修改 runtime registry schema。
- 替换现有 GitHub Issue planning prompts。
- 引入多 Agent 编排。

### 不要做

- 不让用户选择 Planner v1。
- 不把本设计耦合到 GitHub Issue 自动化。
- 不让 Planner 负责文件级实施计划。
- 不允许 Builder 不回到规划阶段就重新定义验收标准。
- 不把完整 skill 文件直接复制进节点 prompt。

## 成功标准

- Planner v1 能为通用 Along Web Task 产出稳定的规划合同。
- 合同能明确区分验收标准和实施步骤。
- Builder 能基于合同制定战术实施计划，而不需要猜测目标结果。
- 设计作为 Along runtime 内部工作流复用到所有项目；业务项目不需要分发或理解角色内部细节。
- 第一版不依赖任何 GitHub Issue 专用工作流。

## 已确认决策

- “一等 Task 记录”指 Planner 合同作为 Task 领域模型中的结构化记录存在，而不是只作为一段 markdown 文本挂在会话日志里。它可以被查询、渲染、关联状态，并被后续 Builder / Tester / Reviewer 消费。
- 第一版不强制做复杂的结构化 UI。先让主流程跑通：Planner 合同可以先以稳定 artifact 或记录形式保存，但必须和 Builder 的战术实施计划分开持久化。
- Builder 的战术实施计划必须独立于 Planner 合同保存。Planner 合同定义目标和验收边界，Builder 计划定义代码级执行路径。
- 前期不需要把 `Acceptance Criteria` 做成独立交互 UI 区块。先保证 Planner -> 确认 -> Builder 的主流程可用，交互细节后续再完善。
- 本设计阶段的未决问题已收敛完成，文档可作为 Planner v1 的当前基线。
