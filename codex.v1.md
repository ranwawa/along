# Verify 阶段详细计划

## Summary

Verify 是 Executor 完成代码与 auto-commit 之后、Delivery 创建 PR/发布之前的生产级硬闸门。它必须独立于 Executor，基于项目显式生产契约运行全量必需检查，并由独立 AI Reviewer 复核 diff、测试证据和风险。只有 Verify 通过，任务才从 `verifying` 进入 `implemented`，随后才允许 Delivery。

当前代码已经有 `exec.completed -> verifying` 和 `exec.verified -> implemented` 状态，但缺少真正的 Verifier。现有流程的核心问题是：auto-commit 成功后触发 `exec.completed`，任务处于 `EXEC + ACTIVE/verifying`；autonomous continuation 会在 `EXEC + ACTIVE` 时调度 Delivery；但 Delivery guard 又要求 `LIFECYCLE.WAITING`。这说明 `verifying` 本来就是验证窗口，只是验证逻辑还没有落地。

v1 采用两层验证：

1. Executor 自检：通过 prompt 强制 Executor 在编码过程中运行增量检查，降低后续失败率。
2. 独立 Verifier：commit 后由系统级验证器运行完整质量门禁和 AI Reviewer 审查，作为 Delivery 前的唯一准入。

## Key Changes

- 新增 Verifier 阶段：
  - Executor auto-commit 成功后触发 `exec.completed`，任务进入 `verifying/ACTIVE`。
  - Verifier 读取已批准 Plan、Executor tactical plan、commit/diff、项目生产契约和质量命令结果。
  - Verifier 通过后触发 `exec.verified`，任务进入 `implemented/WAITING`。
  - Delivery 只允许在 verified 后执行，不再负责验证通过状态。

- 强化 Executor 自检：
  - 修改 `executor-exec.md`，要求 Executor 完成代码后运行与变更相关的 lint、test、typecheck。
  - 自检属于尽力而为层，不能替代独立 Verifier。
  - Executor 如果发现检查失败，必须修复后重新运行，不得在已知失败时结束实现。

- 新增项目生产契约：
  - 使用 `.along/production-contract.json` 作为 Verify 的显式输入。
  - 缺失 contract 时，生产级 autonomous 任务必须失败并提示接入缺口，不能默认通过。
  - Contract 声明全量必跑 gate：typecheck、lint、unit、integration/e2e、build、安全或迁移检查等。
  - Verify 使用默认分支上的 contract 作为本次任务权威版本；如果任务修改 contract、CI、hook 或质量脚本，本次不能用修改后的规则自证通过，必须标记为高风险。

- Verify 结果存储：
  - v1 不新增 DB 表，使用现有 `agent_result` artifact。
  - metadata 使用 `kind: "verification_report"`，记录 status、attempt、commitShas、commandResults、reviewDecision、riskLevel、startedAt、endedAt。
  - artifact body 写中文摘要，供 UI、PR body 和后续 Executor fix prompt 使用。

## Implementation Details

- 状态机与调度：
  - v1 不新增 workflow state，优先复用现有 `exec.completed`、`exec.verified`、`task.failed`。
  - `exec.completed` 后停在 `verifying/ACTIVE`，此状态只允许 Verify 或人工接管，不允许 Delivery。
  - `continueAutonomousTaskAfterExec` 不再在 `EXEC + ACTIVE` 时调度 Delivery；改为在 `EXEC + WAITING` 且状态为 implemented 时调度 Delivery。
  - 新增 Verify 调度入口：auto-commit 成功后调度 Verify；手动 API 也可触发 Verify。
  - Delivery 中移除或保护 `exec.verified` transition，避免 verified 后重复 transition 报错。
  - Delivery 成功创建 PR 后只记录交付结果；是否 `task.accepted` 仍由验收/完成动作决定，不能把“创建 PR”直接等同于“任务已验收”。

- 确定性验证 gate：
  - 新增 `task-verification-gate.ts`，只负责按 contract 执行命令。
  - 每个 step 记录 name、command、args、cwd、exitCode、durationMs、stdout/stderr 摘要。
  - 默认 fail-fast：任一 required step 失败即停止后续 required step。
  - 命令执行前后检查 git 工作区；Verify 命令导致工作区变脏时失败。
  - 输出必须做长度截断和 secret redaction，避免 token、密码或大日志写入 artifact。

- 验证循环：
  - 新增 `task-verification-loop.ts`，负责 verify -> fix -> re-commit -> re-verify。
  - 初次 Verify 失败后，最多允许 Executor 修复 `maxFixAttempts=2` 轮。
  - Fix agent 只能修复 verification report 指出的失败，不允许扩大原需求。
  - 每轮修复后必须重新 auto-commit，并重新运行全量 Verify。
  - 超过最大修复次数后触发 `task.failed`，不创建 PR，不继续 Delivery。

- 独立 AI Reviewer：
  - 命令全绿后，启动 read-only Reviewer。
  - Reviewer 读取 approved plan、tactical plan、diff、commit、verification command results。
  - Reviewer 只能输出结构化 JSON：`APPROVE` 或 `REQUEST_CHANGES`。
  - `REQUEST_CHANGES` 必须包含阻塞问题、文件线索、风险说明和建议修复方向。
  - Reviewer 不写代码；修复仍交给 Executor fix loop。

- Project Contract v1 最小结构：
  - `version`
  - `verify.requiredCommands[]`
  - `verify.maxFixAttempts`
  - `verify.timeoutMs`
  - `verify.forbiddenPaths[]`
  - `verify.protectedGatePaths[]`
  - `verify.requiredEvidence[]`
  - `delivery.allowAfterVerifyOnly: true`
  - `autonomous.enabled: true/false`

- Prompt 与文件入口：
  - 修改 `src/agents/workflow-node-prompts/executor-exec.md`，增加 Executor 自检要求。
  - 新增 `src/agents/workflow-node-prompts/verification-fix.md`，用于 Verify 失败后的定向修复。
  - 新增 `src/domain/task-verification-gate.ts`，实现确定性验证命令执行。
  - 新增 `src/domain/task-verification-loop.ts`，实现验证、自修、重新提交和重验循环。
  - 修改 `src/domain/task-exec-agent.ts`，在 auto-commit 成功后接入 Verify。
  - 修改 `src/integration/task-autonomous-continuation.ts`，只在 verified/WAITING 后调度 Delivery。
  - 修改 `src/domain/task-delivery.ts`，移除 Delivery 对 `exec.verified` 的职责。

- UI/API：
  - `TaskAgentStage` 增加 `verify`。
  - Task flow 增加 Verify stage：实现完成后显示“验证中”，通过后显示“待交付”。
  - 新增手动动作：`start_verify` / `rerun_verify`。
  - API 增加 `POST /api/tasks/:taskId/verify`，用于手动触发 Verify。
  - Task detail 展示最近一次 verification report：命令结果、Reviewer 结论、失败原因和剩余自修次数。

## Decisions From Claude Plan

吸收：

- 保留“两层验证”设计：Executor 增量自检 + 独立 Verifier 全量 gate。
- 明确当前流程 bug：`verifying/ACTIVE` 会误触发 autonomous Delivery，而 Delivery guard 又要求 `WAITING`。
- 采用确定性 `task-verification-gate.ts` 和循环型 `task-verification-loop.ts` 的拆分。
- 增加 `verification-fix.md`，让修复 prompt 只围绕验证失败证据。
- 测试中明确覆盖 autonomous guard 从 ACTIVE 改为 WAITING 的行为。

避免：

- 不把验证配置放进 `.along/setting.json` 作为生产权威；生产级标准必须进入 `.along/production-contract.json`。
- 不允许“无配置则 passed=true”；缺少生产契约时 autonomous production 必须阻塞。
- 不把 PR 创建成功直接等同于 `task.accepted`；PR 创建只是 Delivery 完成，最终验收仍由完成动作负责。
- 不把重试次数写成含糊的“3 轮”；v1 明确为初次 Verify 后最多 2 轮自动修复。
- 不用 Executor 的自检结果替代独立 Verify；自检只能降低失败概率。

## Test Plan

- 状态流测试：
  - `exec.completed` 后进入 `verifying/ACTIVE`。
  - `EXEC + ACTIVE/verifying` 不再触发 Delivery。
  - Verify passed 后触发 `exec.verified` 并进入 `implemented/WAITING`。
  - `EXEC + WAITING/implemented` 才能触发 Delivery。
  - Delivery 不重复触发 `exec.verified`。

- Verifier gate 单元测试：
  - 所有 required steps 通过时返回 passed。
  - 某 step 失败时 fail-fast，并记录失败 step、exitCode、duration 和输出摘要。
  - contract 缺失时失败，不默认通过。
  - Verify 命令导致工作区变脏时失败。
  - protected gate 文件被修改时标记高风险并拒绝使用新规则自证。

- Verifier loop 单元测试：
  - 验证通过后触发 `exec.verified`。
  - 命令失败时生成 failed verification report。
  - 命令通过但 Reviewer request changes 时仍失败。
  - 第一次 Verify 失败后调度 Executor fix。
  - fix 后重新 commit 并重新 Verify。
  - 超过 `maxFixAttempts=2` 后触发 `task.failed`，不调度 Delivery。

- Prompt 测试：
  - `executor-exec.md` 包含增量自检要求。
  - `verification-fix.md` 明确限制只修复验证失败问题。

- 集成测试：
  - 模拟业务仓 happy path：Plan -> Exec -> Commit -> Verify -> Delivery。
  - 模拟业务仓质量失败后自修成功。
  - 模拟 lint/test/build 全绿但 AI Reviewer 拒绝。
  - 模拟 contract 修改任务，需要人工介入或高风险阻断。

## Assumptions

- Verify 是生产级硬门禁，不提供“跳过验证继续交付”的 autonomous 路径。
- Verify 全量运行项目 contract 中声明的 required gates，不做影响范围裁剪。
- AI Reviewer 不写代码，只审查证据和 diff；修复仍交给 Executor。
- v1 先用结构化 artifact 存证据，暂不新增 verification 专用 DB 表。
