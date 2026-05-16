import type {
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from '../domain/task-planning';
import type { VerificationStepResult } from '../domain/task-verification-gate';
import {
  loadWorkflowNodePrompt,
  renderAgentMarkdownTemplate,
} from './workflow-node-prompt-loader';

const VERIFICATION_FIX_PROMPT_ID = 'verification-fix';
const PLAN_BODY_LIMIT = 4000;
const TASK_BODY_LIMIT = 2000;

function truncateText(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n...（内容已截断）`;
}

export interface VerificationFixPromptInput {
  snapshot: TaskPlanningSnapshot;
  approvedPlan: TaskPlanRevisionRecord;
  worktreePath: string;
  verificationSummary: string;
  failedSteps: VerificationStepResult[];
  attempt: number;
  maxAttempts: number;
}

export function buildVerificationFixPrompt(
  input: VerificationFixPromptInput,
): string {
  const template = loadWorkflowNodePrompt({ name: VERIFICATION_FIX_PROMPT_ID });
  return renderAgentMarkdownTemplate(template.content, {
    verificationSummary: input.verificationSummary,
    attempt: String(input.attempt),
    maxAttempts: String(input.maxAttempts),
    contextJson: JSON.stringify(
      {
        task: {
          taskId: input.snapshot.task.taskId,
          title: input.snapshot.task.title,
          body: truncateText(input.snapshot.task.body, TASK_BODY_LIMIT),
          worktreePath: input.worktreePath,
        },
        approvedPlan: {
          planId: input.approvedPlan.planId,
          version: input.approvedPlan.version,
          body: truncateText(input.approvedPlan.body, PLAN_BODY_LIMIT),
        },
      },
      null,
      2,
    ),
  });
}
