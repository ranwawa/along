import { z } from 'zod';
import {
  loadWorkflowNodePrompt,
  renderAgentMarkdownTemplate,
} from '../agents/workflow-node-prompt-loader';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  type RunTaskAgentTurnOutput,
  runTaskAgentTurn,
} from './task-agent-runtime';
import { publishChatReply } from './task-chat';
import {
  LIFECYCLE,
  readTaskPlanningSnapshot,
  type TaskPlanningSnapshot,
} from './task-planning';

const CHAT_NODE_PROMPT_ID = 'chat';
const CHAT_NODE_PROMPT_VERSION = 'v1';

const CHAT_OUTPUT_SCHEMA = z.object({
  body: z.string().min(1),
  suggestEscalate: z.boolean().optional(),
});

type ChatOutput = z.infer<typeof CHAT_OUTPUT_SCHEMA>;

export interface RunTaskChatAgentInput {
  taskId: string;
  agentId?: string;
  cwd: string;
  modelId?: string;
  personalityVersion?: string;
}

export interface RunTaskChatAgentOutput {
  body: string;
  suggestEscalate: boolean;
}

function buildChatPrompt(snapshot: TaskPlanningSnapshot): string {
  const template = loadWorkflowNodePrompt({ name: CHAT_NODE_PROMPT_ID });
  return renderAgentMarkdownTemplate(template.content, {
    workflowIntro: `当前 workflow: ${snapshot.task.currentWorkflowKind}`,
    stateSummary: `workflowKind=${snapshot.task.currentWorkflowKind}`,
    snapshotJson: JSON.stringify(
      {
        task: {
          taskId: snapshot.task.taskId,
          title: snapshot.task.title,
          body: snapshot.task.body,
        },
        recentArtifacts: snapshot.artifacts.slice(-10).map((a) => ({
          type: a.type,
          role: a.role,
          body: a.body.slice(0, 500),
          createdAt: a.createdAt,
        })),
      },
      null,
      2,
    ),
  });
}

function parseChatOutput(output: RunTaskAgentTurnOutput): Result<ChatOutput> {
  if (output.structuredOutput !== undefined) {
    const result = CHAT_OUTPUT_SCHEMA.safeParse(output.structuredOutput);
    if (result.success) return success(result.data);
  }

  const text = output.assistantText.trim();
  if (!text) return failure('Chat 输出为空');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      const result = CHAT_OUTPUT_SCHEMA.safeParse(parsed);
      if (result.success) return success(result.data);
    } catch {}
  }

  return success({ body: text, suggestEscalate: false });
}

export async function runTaskChatAgent(
  input: RunTaskChatAgentInput,
): Promise<Result<RunTaskChatAgentOutput>> {
  const snapshotRes = readTaskPlanningSnapshot(input.taskId);
  if (!snapshotRes.success) return snapshotRes;
  if (!snapshotRes.data) return failure(`Task 不存在: ${input.taskId}`);
  const snapshot = snapshotRes.data;

  if (snapshot.task.lifecycle === LIFECYCLE.DONE) {
    return failure('Task 已关闭，不能运行 Chat');
  }

  const agentId = input.agentId || 'chat';
  const prompt = buildChatPrompt(snapshot);

  const result = await runTaskAgentTurn({
    taskId: input.taskId,
    threadId: snapshot.thread.threadId,
    agentId,
    prompt,
    cwd: input.cwd,
    modelId: input.modelId,
    personalityVersion: input.personalityVersion,
    inputArtifactIds: snapshot.artifacts.map((a) => a.artifactId),
    outputMetadata: {
      kind: 'chat_turn',
      nodePrompt: {
        name: CHAT_NODE_PROMPT_ID,
        version: CHAT_NODE_PROMPT_VERSION,
      },
    },
    options: {
      outputFormat: {
        type: 'json_schema',
        schema: {
          name: 'chat_output',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              body: { type: 'string' },
              suggestEscalate: { type: 'boolean' },
            },
            required: ['body', 'suggestEscalate'],
            additionalProperties: false,
          },
        },
      },
    },
  });

  if (!result.success) return result;
  if (result.data.run.status === 'cancelled') {
    return failure('Chat Agent Run 已取消');
  }

  const parsed = parseChatOutput(result.data);
  if (!parsed.success) return parsed;

  const publishRes = publishChatReply({
    taskId: input.taskId,
    body: parsed.data.body,
    agentId,
  });
  if (!publishRes.success) return publishRes;

  return success({
    body: parsed.data.body,
    suggestEscalate: parsed.data.suggestEscalate ?? false,
  });
}
