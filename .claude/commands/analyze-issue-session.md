---
description: 针对 resolve-github-issue.md 的执行结果进行深度分析与 SOP 优化建议
---

# 角色

你是一个顶级 AI Agent 工程专家，擅长分析大模型的执行轨迹（Trace）、排查指令遵循度问题（Instruction Following）以及优化 SOP（标准作业程序）。

# 任务目标

通过分析一个 AI Agent 在处理 GitHub Issue 时的**原始任务要求**、**遵循的 SOP** 以及**实际执行会话日志**，评估其表现并给出针对性的调优建议。

# 输入上下文

## 1. 原始 Issue 详情 ($1)

[此处请粘贴 Issue 的标题、描述及相关上下文]

## 2. 约束 SOP (resolve-github-issue.md)

[此处请粘贴 /Users/macbookpro/Documents/rww/kinkeeper/.pi/prompts/resolve-github-issue.md 的完整内容]

## 3. 简化后的执行日志 (Simplified Timeline)

[此处请粘贴执行 `python3 .pi/sessions/analyze-session.py .pi/sessions/$1-session.jsonl --timeline --errors --summary` 后的输出内容]

# 分析维度

1. **SOP 依从度 (Compliance)**:
   - 是否漏掉了步骤？是否在未获得成功返回前就标记了 `[x]`？
   - 是否私自使用了 `git commit/push` 而非 `commit_and_push` 扩展工具？
   - 是否在 `.pi/sessions/` 目录下正确创建并维护了 `$1-todo.md`？

2. **工具调用轨迹 (Efficiency)**:
   - 针对 `read`、`bash`、`edit` 等原子工具，是否存在无效的重复调用（如：刚读完一个文件立刻又读一遍）？
   - 搜索定位问题的逻辑是否连贯，还是在代码库中盲目打转？
   - 是否有死循环或被某些错误（如 Linter 报错）卡住很久？

3. **逻辑与质量 (Quality)**:
   - Agent 是否真正理解了 Issue 的病灶？
   - 提交的 `commit message` 是否严格符合 `conventional-commits` 规范？
   - PR 的总结内容是否详实？

4. **异常恢复 (Robustness)**:
   - 遇到工具返回 `isError: true` 时，Agent 是能够优雅重试、更换思路还是陷入混乱？

# 输出要求 (Report format)

请输出一份 Markdown 格式的行为分析报告，包含：

- **## 评分与概览**: 满分 10 分，给出综合得分及一句话评价。
- **## 违规/异常点**: 逐条列出发现的指令违反、逻辑错误或低效行为。
- **## 关键环节复盘**: 对分析、修复、测试这三个核心阶段的执行质量进行点评。
- **## 调优建议 (Action Items)**:
  - **对提示词 (Prompt)**: `resolve-github-issue.md` 中哪些描述容易造成歧义，需要如何加固？
  - **对 Agent 行为**: 在处理此类问题时，Agent 应该增加哪些预判或防御逻辑？
  - **对配套脚本**: `analyze-session.py` 或其它工具是否需要增加更多维度？

---

**开始分析！**
