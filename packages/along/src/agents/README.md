# Agent 配置

`packages/along/src/agents` 是 Along 运行时 agent 规则的唯一维护入口，覆盖角色提示词、输出格式、质量约束和共享分类规则。

维护约束：

- 新增或修改 Task agent 提示词、输出 schema、分类规则时，先改本目录。
- `packages/along/src/domain` 只负责业务编排和调用本目录的配置，不再直接硬编码 agent 规则。
- 项目分发给业务仓的 agent 工作流 prompt 维护在 `packages/preset-assets/agents/prompts`，由 `along project-sync` 同步。
- 不为旧配置路径增加兼容层；迁移影响应在交付说明中明确。
