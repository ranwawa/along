import { consola } from 'consola';
import { getErrorMessage } from '../core/common';
import { runTaskTitleSummary } from '../domain/task-title-summary';
import type { TaskApiContext } from './task-api';

const logger = consola.withTag('task-api');

export function scheduleTitleSummary(
  context: TaskApiContext,
  input: { taskId: string; body: string; attachmentCount?: number },
) {
  if (context.scheduleTitleSummary) {
    context.scheduleTitleSummary(input);
    return;
  }
  void runTaskTitleSummary(input)
    .then((result) => {
      if (!result.success) {
        logger.warn(`[Task ${input.taskId}] 标题自动总结失败: ${result.error}`);
      }
    })
    .catch((error: unknown) => {
      logger.error(
        `[Task ${input.taskId}] 标题自动总结异常: ${getErrorMessage(error)}`,
      );
    });
}
