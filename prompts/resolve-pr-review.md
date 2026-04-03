---
description: 处理 PR 代码审查反馈，修复或讨论 Reviewer 提出的问题
---

我们要着手处理 Issue **$1** 对应 PR 的代码审查反馈。

这是一次协作过程。你作为技术专家，既要能理解并采纳合理的优化建议，也要在认为方案存在隐患或冲突时与 Reviewer 进行专业探讨。

## 前置信息

**工作目录**：你当前已在 Issue 的 worktree 中（`~/.along/worktrees/$1/`）。

**待处理评论**：`~/.along/sessions/$1-pr-comments.json` 包含本轮需要处理的新评论列表。

请先读取该文件，了解所有待处理的评论内容。

## 工作流程

### 第一步：理解评论与代码变更

1. **读取评论文件**：`~/.along/sessions/$1-pr-comments.json`
2. **查看变更范围**：
   ```bash
   git log --oneline -5
   git diff HEAD~1 --name-only
   ```
3. **逐条分析评论**：
   - 将评论中的 `path` 和 `line` 与代码对应
   - 结合 `diff_hunk` 理解上下文
   - 理解 reviewer 的关切点

### 第二步：逐条处理评论

对每一条评论，遵循"**决策 → 执行 → 回复**"的原子逻辑：

1. **认可（Agree）**：
   a. 在本地实施修改（使用 `Edit`）
   b. 修改完成后，回复评论：
      ```bash
      gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="已按建议修正"
      ```
   （owner、repo、pr_number 从评论文件的 `meta` 字段获取）

2. **异议（Disagree）**：
   - 回复评论详述技术理由，不修改代码
   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies -f body="技术理由..."
   ```

3. **确保每条评论都有回复**。

### 第三步：质量门禁检查

**必须全部通过才能继续**：

1. **格式化**：`npx prettier --check <修改的文件>` → 如有问题 `npx prettier --write`
2. **Lint**：`npx eslint <修改的文件>` → 必须 0 error、0 warning
3. **类型检查**：`npx tsc --noEmit` → 必须 0 error
4. **测试**：`npm test -- --coverage --testPathPattern="<相关文件>"` → 必须通过

**任一失败**：修复后重新检查，直到全部通过。

### 第四步：提交并推送

所有检查通过后：

```bash
along commit-push --message "fix(scope): 按评审意见修复问题" --files <文件列表>
```

## 注意事项

- 专注于评论中指出的问题，不要做额外的重构
- 如果评论涉及架构级别的改动，回复说明影响范围并等待 reviewer 确认
- 每条评论必须有明确的处理结果（修复或回复理由）
