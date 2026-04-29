---
description: 修复 CI 检查失败，分析日志并修复代码
---

我们要修复 Issue **$1** 对应 PR 的 CI 检查失败。

## 前置信息

**工作目录**：你当前已在 Issue 的 worktree 中。

**CI 失败信息**：`../ci-failures.json` 包含本轮失败的 CI check 详情。

请先读取该文件，了解所有失败的 check runs。

## 工作流程

### 第一步：分析 CI 失败原因

1. **读取失败信息文件**：`../ci-failures.json`
2. **获取详细日志**：对每个失败的 check run，通过以下方式获取日志：
   ```bash
   gh run view <run_id> --repo {owner}/{repo} --log-failed
   ```
   如果 `run_id` 不可用，尝试：
   ```bash
   gh run list --repo {owner}/{repo} --branch <branch> --status failure --limit 1 --json databaseId --jq '.[0].databaseId'
   ```
   然后：
   ```bash
   gh run view <id> --repo {owner}/{repo} --log-failed
   ```
3. **查看当前代码变更**：
   ```bash
   git log --oneline -5
   git diff HEAD~1 --name-only
   ```
4. **定位失败根因**：结合日志和代码变更，确定导致 CI 失败的具体原因

### 第二步：修复代码

1. 根据分析结果修复导致 CI 失败的代码问题
2. 常见 CI 失败类型及对应修复策略：
   - **测试失败**：修复失败的测试用例或修复导致测试失败的代码
   - **类型检查失败**：修复 TypeScript 类型错误
   - **Lint 失败**：修复代码风格/规范问题
   - **构建失败**：修复编译错误或依赖问题
3. 不要忽略或跳过失败的测试，要真正修复问题

### 第三步：本地质量门禁验证

**必须全部通过才能继续**：

1. **格式化**：`npx prettier --check <修改的文件>` → 如有问题 `npx prettier --write`
2. **Lint**：`npx eslint <修改的文件>` → 必须 0 error、0 warning
3. **类型检查**：`npx tsc --noEmit` → 必须 0 error
4. **测试**：`npm test -- --coverage --testPathPattern="<相关文件>"` → 必须通过

**任一失败**：修复后重新检查，直到全部通过。

### 第四步：提交并推送

所有检查通过后：

```bash
along commit-push --message "fix(scope): 修复 CI 检查失败" --files <文件列表>
```

## 注意事项

- 专注于修复 CI 失败的问题，不要做额外的重构
- 如果 CI 失败原因不明确，先仔细阅读完整的 CI 日志
- 如果失败与依赖有关，检查 package.json 和 lock 文件
- 确保本地验证通过后再推送，避免反复触发 CI
