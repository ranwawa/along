# Task/Thread Planning Session 实现方案

## 目标

Task 是业务任务事实源，Thread 是围绕 Task 的会话事实源，Artifact 记录用户输入、计划、反馈、审批和 Agent 结果。Codex thread id 只作为执行器会话优化项；即使 Codex thread 失效，系统也应能用 Along 保存的 Artifact 重建上下文继续。

## 原则

- Along Thread 是主会话系统，不能依赖执行器私有会话保存业务事实。
- Codex session 只负责提升上下文连续性和执行体验。
- 用户通过 Web 输入、Approve 按钮和后台 API 推进流程，CLI 主要用于调试。
- GitHub Issue、PR、CI run 都是外部引用或 Artifact，不是 Task 核心模型。

## 核心表

- `task_items`：任务主记录。
- `task_threads`：任务会话。
- `task_artifacts`：用户消息、计划、反馈、审批、Agent 结果。
- `task_plan_revisions`：正式计划版本。
- `task_feedback_rounds`：围绕当前计划的一轮反馈。
- `task_agent_bindings`：`threadId + agentId + Codex` 到 Codex thread id 的绑定。
- `task_agent_runs`：每次 Codex 执行记录。

## Codex Thread Resume

同一个 Thread 中启动 Agent 时：

1. 读取 `task_agent_bindings`。
2. 如果存在已保存的 Codex session id，通过 Codex SDK 恢复 thread。
3. 运行中捕获最新 Codex thread id。
4. 完成后写回 Codex session id。
5. 写入 `task_agent_runs`。

如果恢复失败，本次 run 标记失败，但 Along Thread 和 Artifact 仍是事实源，后续可重新构造 prompt 并创建新 Codex thread。

## API

- `POST /api/tasks`
- `POST /api/tasks/:taskId/messages`
- `GET /api/tasks`
- `GET /api/tasks/:taskId`
- `POST /api/tasks/:taskId/approve`
- `POST /api/tasks/:taskId/planner`
- `POST /api/tasks/:taskId/implementation`
- `POST /api/tasks/:taskId/delivery`

`approve` 只批准当前 active Plan，且要求没有未处理 feedback round。implementation 在人工确认实施步骤后进入 Task 专属 worktree，delivery 只基于已有本地 commit 推送并创建 PR。
