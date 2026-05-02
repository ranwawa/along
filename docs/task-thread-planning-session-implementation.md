# Task/Thread Planning Session 实现方案

## 1. 目标

本轮实现的目标是建立一个不依赖 GitHub Issue 的 Planning 会话底座：

- `Task` 是业务任务的事实源。
- `Thread` 是围绕 Task 的会话事实源。
- `Artifact` 记录用户输入、计划、反馈、审批等正式事件。
- Claude Code 的 `session_id` 只作为执行器会话，用于同一个 Agent 在同一个 Thread 中优先 resume。
- 即使 Claude Code 原生 session 丢失，系统也能用 Along 自己保存的 Artifact 重建上下文继续。

本轮不实现完整多 Agent、长期记忆、Linear 集成、网页 UI 重构和 implementation 阶段。

## 2. 设计原则

### 2.1 Along Thread 是主会话

系统状态不能依赖 provider 的私有会话。

必须由 Along 自己保存：

- 用户每轮输入
- 当前有效 Plan
- 历史 Plan
- 当前未处理 Feedback Round
- Planning Update
- Approval
- Agent 运行记录
- provider session id

### 2.2 Provider Session 是优化项

Claude Code session 负责提升上下文连续性和执行体验。

同一个 `threadId + agentId + provider` 应复用同一个 `providerSessionId`。如果 resume 失败，系统应能基于 Thread Artifact 重新组织上下文并启动新 session。

### 2.3 用户只对话，系统管状态

人工入口不应该暴露一组复杂 CLI。

合理入口是：

- Web 输入框
- Web 明确 Approve 按钮
- 后台 API

CLI 最多作为调试入口，不作为主要产品交互方式。

### 2.4 Issue 是 adapter，不是核心模型

GitHub Issue、Linear Issue、PR、CI run 都应作为外部引用或 Artifact 关联到 Task。

Planning 的主流程不应要求存在 `issueNumber`。

## 3. 数据模型

### 3.1 `task_items`

表示用户提出的一件事。

核心字段：

- `task_id`
- `title`
- `body`
- `source`
- `status`
- `active_thread_id`
- `created_at`
- `updated_at`

### 3.2 `task_threads`

表示围绕 Task 的一段会话。

第一阶段只实现 `purpose = planning`。

核心字段：

- `thread_id`
- `task_id`
- `purpose`
- `status`
- `current_plan_id`
- `open_round_id`
- `approved_plan_id`
- `created_at`
- `updated_at`

### 3.3 `task_artifacts`

表示会话中产生的正式事实。

常见类型：

- `user_message`
- `plan_revision`
- `planning_update`
- `approval`
- `agent_result`

核心字段：

- `artifact_id`
- `task_id`
- `thread_id`
- `type`
- `role`
- `body`
- `metadata`
- `created_at`

### 3.4 `task_plan_revisions`

表示正式计划版本。

核心字段：

- `plan_id`
- `task_id`
- `thread_id`
- `version`
- `based_on_plan_id`
- `status`
- `artifact_id`
- `body`
- `created_at`

同一个 Thread 任意时刻最多一个 `active` Plan。

### 3.5 `task_feedback_rounds`

表示用户围绕当前 Plan 的一轮反馈。

核心字段：

- `round_id`
- `task_id`
- `thread_id`
- `based_on_plan_id`
- `feedback_artifact_ids`
- `status`
- `resolution`
- `produced_plan_id`
- `created_at`
- `resolved_at`

同一个 Thread 任意时刻最多一个 open/processing/stale_partial round。

### 3.6 `task_agent_bindings`

绑定 Along Thread 和底层 provider session。

核心字段：

- `thread_id`
- `agent_id`
- `provider`
- `provider_session_id`
- `cwd`
- `model`
- `personality_version`
- `updated_at`

唯一约束：

```text
UNIQUE(thread_id, agent_id, provider)
```

### 3.7 `task_agent_runs`

记录每次 Agent 执行。

核心字段：

- `run_id`
- `task_id`
- `thread_id`
- `agent_id`
- `provider`
- `provider_session_id_at_start`
- `provider_session_id_at_end`
- `status`
- `input_artifact_ids`
- `output_artifact_ids`
- `error`
- `started_at`
- `ended_at`

## 4. Planning 状态流转

### 4.1 创建 Task

输入用户问题后：

1. 创建 `task_items`。
2. 创建 planning `task_threads`。
3. 创建初始 `user_message` artifact。
4. Task 进入 `planning`。
5. Thread 进入 `drafting`。

### 4.2 发布首版 Plan

Agent 产出首版计划后：

1. 创建 `plan_revision` artifact。
2. 创建 `task_plan_revisions` v1。
3. Thread `current_plan_id = plan_v1`。
4. Thread 状态进入 `awaiting_approval`。

### 4.3 用户继续反馈

当存在当前 Plan 时，用户输入被视为针对当前 Plan 的 feedback：

1. 创建 `user_message` artifact。
2. 如果当前无 open round，创建 `task_feedback_rounds`。
3. 将 feedback artifact 纳入当前 round。
4. Thread 进入 `discussing`。

### 4.4 Agent 处理 feedback

只能有两类结果：

- `answer_only`：创建 `planning_update` artifact，关闭 round，Plan 不变。
- `revise_plan`：创建新版 `plan_revision`，旧 Plan superseded，新 Plan active，关闭 round。

### 4.5 Approve

Approve 必须满足：

- 存在当前 active Plan。
- 不存在 open/processing/stale_partial round。
- 批准对象是当前 Plan。

Approve 后：

- Plan 状态变为 `approved`。
- Thread `approved_plan_id = current_plan_id`。
- Thread 状态变为 `approved`。
- Task 状态变为 `planning_approved`。

## 5. Claude Session Resume

### 5.1 正常流程

同一个 Thread 中启动 Planning Agent 时：

1. 读取 `task_agent_bindings`。
2. 如果存在 `provider_session_id`，启动 Claude Code 时传入 `resume`。
3. 运行过程中捕获 SDK message 的 `session_id`。
4. 完成后写回最新 `provider_session_id`。
5. 写入 `task_agent_runs`。

### 5.2 Resume 失败策略

如果 provider resume 失败：

1. 标记本次 run 失败。
2. 保留原始 provider session id 供诊断。
3. 调用方可用 Along Artifact 重新构造完整 prompt，并创建新 provider session。

系统不应因为 provider session 失败而丢失业务会话。

### 5.3 并发约束

同一个 `threadId + agentId + provider` 同一时间只能有一个 active run。

本轮先通过数据模型和 service 约束接口语义，后续接 Web API 时再增加运行时队列。

## 6. 本轮实现范围

本轮落地：

- SQLite schema。
- Task-native planning domain service。
- Agent binding domain service。
- Claude planning runner 支持读取和写回 `providerSessionId`。
- Claude planning runner 记录原始 `agent_result` artifact。
- Planning Agent 编排层负责把 Claude 输出解析为 `plan_revision` 或 `planning_update`。
- Web API 支持创建 Task、读取 Task、追加用户消息、批准 Plan、手动触发 planner。
- webhook-server 复用现有 agent 队列，并按 `taskId` 串行化 Task planner。
- 单元测试覆盖核心 planning 规则和 session binding。

本轮暂不落地：

- along-web UI。
- Linear/GitHub adapter。
- 多 Agent council。
- 长期记忆。
- 自动进入 implementation。

## 7. 当前 Web API

当前人工主入口先落在后台 API，后续再接 along-web UI。

### 7.1 创建 Task 并触发 planner

```http
POST /api/tasks
```

请求体：

```json
{
  "title": "可选标题",
  "body": "用户问题或需求",
  "owner": "可选 GitHub owner",
  "repo": "可选 GitHub repo",
  "cwd": "可选本地执行目录",
  "autoRun": true
}
```

如果提供 `owner/repo`，server 会用 workspace registry 解析本地仓库路径；如果提供 `cwd`，直接使用 `cwd`；否则使用 webhook-server 当前工作目录。

### 7.2 继续讨论

```http
POST /api/tasks/:taskId/messages
```

请求体：

```json
{
  "body": "用户补充、澄清或反馈",
  "cwd": "可选本地执行目录",
  "autoRun": true
}
```

系统会先把用户消息写入 Along Thread Artifact，再通过队列触发同一个 Task planner。planner 会优先复用同一个 `threadId + agentId + provider` 的 provider session。

### 7.3 读取与审批

```http
GET /api/tasks
GET /api/tasks/:taskId
POST /api/tasks/:taskId/approve
POST /api/tasks/:taskId/planner
```

`approve` 只批准当前 active Plan，且要求没有未处理 feedback round。`planner` 是给 Web UI 或排障使用的手动重跑入口，不要求用户记 CLI。
