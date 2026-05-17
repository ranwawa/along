import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { LLMService } from './llm-service';

export type RouterIntent = 'chat' | 'planning' | 'exec';

export interface RouteTaskMessageInput {
  messageBody: string;
  taskTitle: string;
  hasApprovedPlan: boolean;
}

export interface RouteTaskMessageOutput {
  intent: RouterIntent;
}

const PROFILE_ID = 'message-router';

export async function routeTaskMessage(
  input: RouteTaskMessageInput,
): Promise<Result<RouteTaskMessageOutput>> {
  const result = await LLMService.runProfile({
    profileId: PROFILE_ID,
    variables: {
      taskTitle: input.taskTitle,
      messageBody: input.messageBody,
      hasApprovedPlan: String(input.hasApprovedPlan),
    },
  });

  if (!result.success) return result;

  const json = result.data.json as { intent?: string } | null;
  if (!json?.intent) return failure('Router 输出缺少 intent 字段');

  const intent = json.intent as string;
  if (intent === 'chat' || intent === 'planning' || intent === 'exec') {
    if (intent === 'exec' && !input.hasApprovedPlan) {
      return success({ intent: 'planning' });
    }
    return success({ intent });
  }

  return failure(`Router 输出无效 intent: ${intent}`);
}
