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

- 只生成 Codex 相关资产。
- 带有 generated 标记的文件应修改源模板后再同步。
- 同步前要求工作区干净，避免覆盖用户未提交改动。
