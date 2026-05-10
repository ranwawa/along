# Agent 配置

`packages/along/src/agents` 是 Along 运行时 agent 规则的唯一维护入口，覆盖内部工作流节点提示词、输出格式、质量约束和共享分类规则。

维护约束：

- 新增或修改 Task workflow 节点提示词、输出 schema、分类规则时，先改本目录。
- Task workflow 节点提示词正文必须放在 `workflow-node-prompts/*.md`，TypeScript 只负责读取模板、填充上下文和校验输出。
- `packages/along/src/domain` 只负责业务编排和调用本目录的配置，不再直接硬编码 agent 规则。
- 项目分发给业务仓的 agent 工作流 prompt 维护在 `packages/preset-assets/agents/prompts`，由 `along project-sync` 同步。
- Planner / Builder / Tester 等 Along Web Task 节点角色是 Along runtime 内部实现，不分发到业务项目，也不要求业务项目理解其内部提示词。
- 不为旧配置路径增加兼容层；迁移影响应在交付说明中明确。
