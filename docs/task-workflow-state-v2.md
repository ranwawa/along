# Task Workflow State Machine — 重新设计方案

## Context

当前 task-workflow-state 存在以下问题：
- lifecycle 7 个值语义过载（`waiting_user` 覆盖"需补充信息"和"等待批准"两种不同场景，`ready` 承载过多含义）
- ask 类型与 planning/exec 生命周期模型不兼容，硬塞进同一个状态机
- workflowState 的 `completed` 在不同 lifecycle 下含义不同
- 草稿/备忘场景没有归属

本方案重新设计 task 级别的工作流状态机，目标：每个状态值自解释，只看 lifecycle 就能决定行动。

## 设计决策

| 决策 | 结论 |
|------|------|
| 草稿（draft/memo） | 不进入状态机，只是 DB 记录，激活时才初始化 workflow state |
| ask（提问/头脑风暴） | 不进入状态机，靠 task.kind='ask' 区分，对话状态由消息层管理 |
| session-state-machine | 本次不涉及，只定义 task→session 的事件接口点 |
| 状态真相源 | 事件驱动 reducer 为唯一真相源，移除 inferWorkflowState。数据一致性由事件持久化事务保证，离线校验用事件重放 |

---

## 一、状态空间

### Lifecycle（4 值）

| 值 | 语义 | 行动指导 |
|----|------|----------|
| `active` | 系统在工作，不需要人介入 | 等待即可 |
| `waiting` | 球在用户手里，需要人操作才能继续 | 用户需要行动 |
| `done` | 任务结束，不再需要任何操作 | 可归档 |
| `failed` | 出错了，可能需要介入修复或重试 | 需要决策：重试/放弃 |

终态：`done`（不可逆）。`failed` 可恢复。

`done` 附带 `resolution: 'completed' | 'cancelled'` 区分结束原因。

### WorkflowKind（2 值）

| 值 | 含义 |
|----|------|
| `plan` | 规划阶段：产出方案，需要用户审批 |
| `exec` | 实现阶段：执行方案，产出代码/交付物 |

### WorkflowState（per-kind）

**Plan:**

| 状态 | 含义 |
|------|------|
| `drafting` | Agent 正在起草方案 |
| `awaiting_approval` | 方案已出，等用户批准/反馈 |
| `revising` | Agent 根据反馈修改方案中 |

**Exec:**

| 状态 | 含义 |
|------|------|
| `implementing` | Agent 正在执行实现 |
| `verifying` | 实现完成，正在验证 |
| `implemented` | 实现+验证通过，等用户确认交付 |

---

## 二、状态组合与 Lifecycle 映射

| workflowKind | workflowState | lifecycle | 说明 |
|---|---|---|---|
| plan | drafting | active | Agent 起草中 |
| plan | awaiting_approval | waiting | 等用户审批，批准后直接进入 exec |
| plan | revising | active | Agent 根据反馈修改中 |
| exec | implementing | active | Agent 实现中 |
| exec | verifying | active | Agent 验证中 |
| exec | implemented | waiting | 等用户确认交付/验收 |
| — | — | done | 任务结束 |
| — | — | failed | 执行失败 |

关键改进：
- `lifecycle` 完全由 `workflowState` 决定，是其投影，不存在独立赋值
- `waiting` 只出现在两个明确场景：等审批方案、等确认交付
- 不再有 `ready` 这个模糊中间态

---

## 三、事件定义

### 初始化事件

| 事件 | 触发源 | 说明 |
|------|--------|------|
| `task.activated` | 用户 | 草稿激活，初始化状态机。携带 `workflowKind` 参数决定起始阶段 |

### Plan 阶段事件

| 事件 | 触发源 | 说明 |
|------|--------|------|
| `plan.draft_completed` | Agent | 方案起草完成 |
| `plan.feedback_submitted` | 用户 | 用户提交反馈/修改意见 |
| `plan.revision_completed` | Agent | 修改完成，重新提交审批 |
| `plan.approved` | 用户 | 用户批准方案，同时切换到 exec/implementing |

### Exec 阶段事件

| 事件 | 触发源 | 说明 |
|------|--------|------|
| `exec.completed` | Agent/Session | 实现完成，进入验证 |
| `exec.verified` | Agent/Session | 验证通过 |
| `task.accepted` | 用户 | 用户确认交付，任务完成 |

### 通用事件

| 事件 | 触发源 | 说明 |
|------|--------|------|
| `task.failed` | Agent/Session | 执行失败 |
| `task.cancelled` | 用户 | 用户取消任务 |
| `task.retried` | 用户 | 从 failed 状态重试 |
| `recovery.interrupted` | 系统 | 服务重启，中断运行中的任务 |

---

## 四、状态转换表

```
[task.activated(workflowKind='plan')]
  → plan/drafting/active

[task.activated(workflowKind='exec')]
  → exec/implementing/active

plan/drafting/active:
  [plan.draft_completed] → plan/awaiting_approval/waiting
  [task.failed]              → —/—/failed
  [task.cancelled]           → —/—/done(cancelled)

plan/awaiting_approval/waiting:
  [plan.feedback_submitted] → plan/revising/active
  [plan.approved]           → exec/implementing/active
  [task.cancelled]              → —/—/done(cancelled)

plan/revising/active:
  [plan.revision_completed] → plan/awaiting_approval/waiting
  [task.failed]                 → —/—/failed
  [task.cancelled]              → —/—/done(cancelled)

exec/implementing/active:
  [exec.completed] → exec/verifying/active
  [task.failed]              → —/—/failed
  [task.cancelled]           → —/—/done(cancelled)
  [recovery.interrupted]     → —/—/failed

exec/verifying/active:
  [exec.verified]  → exec/implemented/waiting
  [task.failed]          → —/—/failed
  [recovery.interrupted] → —/—/failed

exec/implemented/waiting:
  [task.accepted]  → —/—/done(completed)
  [task.cancelled] → —/—/done(cancelled)

failed:
  [task.retried]   → 回到失败前的 workflowKind/workflowState（由 retry 策略决定）
  [task.cancelled] → —/—/done(cancelled)
```

---

## 五、Guards（前置条件）

| 转换 | Guard |
|------|-------|
| `plan.approved` | 必须存在至少一个 plan revision |
| `exec.verified` | workflowState 必须为 `verifying` |
| `task.accepted` | workflowState 必须为 `implemented` |
| `task.retried` | lifecycle 必须为 `failed` |
| `task.cancelled` | lifecycle 不为 `done` |
| 所有非 `task.activated` 事件 | lifecycle 不为 `done`（终态不可转换） |

---

## 六、每阶段产物

| 阶段 | 进入条件 | 产物 | 产物形式 | 产物用途 |
|------|----------|------|----------|----------|
| plan/drafting | task.activated(plan) | — | — | — |
| plan/awaiting_approval | draft_completed | **架构方案** | Markdown 文档：状态图、流转规则、接口契约、设计决策。面向人，不含实现细节 | 用户审阅、批准/反馈的依据 |
| plan/revising | feedback_submitted | User Feedback | 用户反馈内容 | Agent 修改方案的输入 |
| exec/implementing | plan.approved 或 task.activated(exec) | **详细设计**（agent 内部第一步产出，不触发状态变更） | Markdown 文档：文件清单、函数签名、数据结构变更、实施顺序、验证场景 | Agent 自身的执行指南 |
| exec/verifying | exec.completed | Code Changes | 代码变更集 | 验证的对象 |
| exec/implemented | exec.verified | Verification Result | 验证报告 | 用户验收依据 |
| done(completed) | task.accepted | 完整交付物 | 架构方案 + 详细设计 + 代码 + 验证报告 | 归档 |

> **架构方案 vs 详细设计的边界：** 架构方案回答"要不要这么做"，是 planning 阶段的交付物，需要用户审批。详细设计回答"具体怎么做"，是 exec 阶段 agent 内部的执行准备，不需要用户审批，不体现为独立状态。

---

## 七、每状态可用操作（UI Actions）

| 状态 | 用户可用操作 |
|------|-------------|
| plan/drafting | 取消任务 |
| plan/awaiting_approval | 批准方案、提交反馈、取消任务 |
| plan/revising | 取消任务 |
| exec/implementing | 取消任务 |
| exec/verifying | 取消任务 |
| exec/implemented | 确认交付、取消任务 |
| failed | 重试、取消任务 |
| done | 无（只读） |

---

## 八、与状态机外部的接口

### Draft → 激活

任务创建时 `workflow_state = null`。用户点击"开始"或发送第一条指令时触发 `task.activated`，此时：
1. 确定初始 workflowKind（默认 `plan`，用户可选择跳过规划直接实现）
2. 初始化 WorkflowRuntimeState
3. 启动对应的 agent session

### Ask 类型

`task.kind = 'ask'` 的任务永远不进入状态机。其状态由对话层管理：
- 有未回答的消息 → "进行中"
- 对话结束/用户关闭 → "已结束"

### Session 上报

Session 完成时向 task 状态机发送事件：
- 成功完成 → `plan.draft_completed` / `exec.completed` / `exec.verified`（取决于当前阶段）
- 失败 → `task.failed`
- 崩溃恢复 → `recovery.interrupted`

---

## 九、与当前设计的主要差异

| 维度 | 当前 | 新方案 |
|------|------|--------|
| lifecycle 值数 | 7 | 4 |
| workflowKind | 3 (ask/planning/exec) | 2 (plan/exec) |
| workflowState (plan) | 5 (drafting/waiting_user/awaiting_approval/feedback/planned) | 3 (drafting/awaiting_approval/revising) |
| workflowState (exec) | 5 (implementing/waiting_user/verifying/completed/failed) | 3 (implementing/verifying/implemented) |
| 事件数 | 20 | 12 |
| ask 处理 | 在状态机内 | 状态机外 |
| draft 处理 | 无 | 状态机外，显式激活 |
| `waiting_user` 语义 | 模糊（补充信息 or 审批） | 明确（只有审批方案和确认交付） |
| `ready` / `approved` 中间态 | 存在，含义过载 | 移除，`plan.approved` 直接切换到 exec |
| 状态真相源 | reducer + inferWorkflowState 双源 | reducer 唯一真相源，移除 inferWorkflowState |
| resolution | 无 | done 附带 completed/cancelled |

---

## 涉及的关键文件

- `packages/along/src/domain/task-workflow-state.ts` — 核心 reducer，完全重写
- `packages/along/src/domain/task-planning.ts` — 移除 inferWorkflowState，状态读取改为从持久化的 workflow state 直接获取
- `packages/along/src/domain/task-display-state.ts` — 适配新状态值
- `packages/along-web/src/task-planning/flowActionRouter.ts` — 适配新 action 映射
- `packages/along/src/domain/session-state-machine.ts` — 调整事件上报接口（小改）

## 验证方式

1. 重写 `task-workflow-state.test.ts`，覆盖所有转换路径和 guard 条件
2. 确保所有合法路径可达 `done`，所有非法路径被 guard 拒绝
3. 验证 `failed` → `retried` → 恢复路径
4. 验证 `recovery.interrupted` 在各状态下的行为
5. UI 层验证：每个状态下的按钮可见性与 action 映射正确
