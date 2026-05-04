import { z } from 'zod';

export const TRIAGE_CLASSIFICATIONS = [
  'bug',
  'feature',
  'question',
  'spam',
] as const;

export type TriageClassification = (typeof TRIAGE_CLASSIFICATIONS)[number];

export const TRIAGE_SYSTEM_PROMPT = `你是一个 GitHub Issue 分类助手。你的任务是判断一个 Issue 的类型。

请分析以下 Issue 的标题、正文和标签，并将其分类为以下四类之一：

1. **bug**：缺陷、回归、异常行为，需要代码修复
2. **feature**：新功能、增强、重构、文档改进，需要代码修改
3. **question**：提问、求助、咨询，不需要代码修改
4. **spam**：广告、无意义内容、测试 Issue、打招呼、垃圾信息

注意：
- 如果无法确定是 bug 还是 feature，请分类为 bug（宁可多做，不可错过）
- 如果无法确定是否需要代码修改，请分类为 bug
- question 的 replyMessage 应友好、专业，尽量给出有帮助的回答方向
- spam 的 replyMessage 应简短说明关闭原因
- question/spam 的 replyMessage 末尾必须加上提示："\\n\\n---\\n> 如果你认为这个 Issue 确实需要代码修改，请在 Issue 中评论 \`/approve\` 以重新触发处理流程。"`;

export const TriageResultSchema = z.object({
  classification: z
    .enum(TRIAGE_CLASSIFICATIONS)
    .describe(
      'Issue 分类：bug=缺陷/回归, feature=新功能/增强, question=提问/咨询, spam=垃圾信息',
    ),
  reason: z.string().describe('分类原因（中文简述）'),
  replyMessage: z
    .string()
    .optional()
    .describe('仅 question/spam 时需要的友好中文回复消息，Markdown 格式'),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
