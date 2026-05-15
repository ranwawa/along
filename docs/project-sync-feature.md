# Project Sync

`along project-sync` 负责把项目基建资产同步到当前仓库，包括质量脚本、hook、AGENTS.md、Codex prompts 和 Codex skills。

## 配置

`.along/setting.json` 示例：

```json
{
  "agent": "codex",
  "distribution": {
    "agent": {
      "editors": ["codex"]
    }
  }
}
```

## Codex 输出目录

- `.codex/prompts/*`
- `.codex/skills/*`

## 约束

- 编辑器原生资产目前只生成 Codex 相关目录。
- Along Web Task 的 Planner / Executor / Tester 等节点角色和 runtime prompt 是 Along 内部实现，不分发到目标项目。
- 带有 generated 标记的文件应修改源模板后再同步。
- 同步前要求工作区干净，避免覆盖用户未提交改动。
