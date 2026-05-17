import type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskExecRun,
  ScheduledTaskPlanningRun,
  ScheduledTaskTitleSummaryRun,
  TaskApiSchedulerContext,
} from '../../app/scheduler/types';
import { HTTP_NOT_FOUND } from './http-status';
import {
  handleTaskAttachmentRequest,
  handleTaskCreateRequest,
  handleTaskGetRequest,
  handleTaskListRequest,
  handleTaskMessageRequest,
} from './task-api-handlers';
import {
  handleTaskApproveRequest,
  handleTaskCancelAgentRequest,
  handleTaskCloseRequest,
  handleTaskCompleteRequest,
  handleTaskDeleteRequest,
  handleTaskDeliveryRequest,
  handleTaskExecRequest,
  handleTaskManualCompleteRequest,
  handleTaskPlannerRequest,
} from './task-api-handlers-actions';
import { errorResponse } from './task-api-utils';

export type {
  ScheduledTaskDeliveryRun,
  ScheduledTaskExecRun,
  ScheduledTaskPlanningRun,
  ScheduledTaskTitleSummaryRun,
};

export type TaskApiContext = TaskApiSchedulerContext;

type TaskActionHandler = (
  req: Request,
  taskId: string,
  context: TaskApiContext,
) => Response | Promise<Response>;

const ACTION_ROUTES: Record<string, TaskActionHandler> = {
  approve: (_req, taskId) => handleTaskApproveRequest(taskId),
  'cancel-agent': (req, taskId) => handleTaskCancelAgentRequest(req, taskId),
  close: (req, taskId) => handleTaskCloseRequest(req, taskId),
  complete: (_req, taskId, context) =>
    handleTaskCompleteRequest(taskId, context),
  delete: (_req, taskId) => handleTaskDeleteRequest(taskId),
  delivery: handleTaskDeliveryRequest,
  exec: handleTaskExecRequest,
  'manual-complete': (req, taskId) =>
    handleTaskManualCompleteRequest(req, taskId),
  messages: handleTaskMessageRequest,
  planner: handleTaskPlannerRequest,
};

export function isTaskApiPath(pathname: string): boolean {
  return pathname === '/api/tasks' || pathname.startsWith('/api/tasks/');
}

export async function handleTaskApiRequest(
  req: Request,
  url: URL,
  context: TaskApiContext,
): Promise<Response> {
  const collectionResponse = await handleCollectionRequest(req, url, context);
  if (collectionResponse) return collectionResponse;

  const parts = url.pathname.split('/').filter(Boolean);
  const taskId = parts[2];
  const action = parts[3];
  const attachmentId = parts[4];
  if (!taskId) return errorResponse('缺少 taskId', HTTP_NOT_FOUND);
  if (!action && req.method === 'GET') return handleTaskGetRequest(taskId);
  if (action === 'attachments' && attachmentId && req.method === 'GET') {
    return handleTaskAttachmentRequest(taskId, attachmentId);
  }

  return handleTaskActionRequest(req, taskId, action, context);
}

async function handleCollectionRequest(
  req: Request,
  url: URL,
  context: TaskApiContext,
): Promise<Response | null> {
  if (url.pathname !== '/api/tasks') return null;
  if (req.method === 'GET') return handleTaskListRequest(url);
  if (req.method === 'POST') return handleTaskCreateRequest(req, context);
  return errorResponse('未找到 Task API', HTTP_NOT_FOUND);
}

function handleTaskActionRequest(
  req: Request,
  taskId: string,
  action: string | undefined,
  context: TaskApiContext,
): Response | Promise<Response> {
  const handler = action ? ACTION_ROUTES[action] : undefined;
  if (!handler || req.method !== 'POST') {
    return errorResponse('未找到 Task API', HTTP_NOT_FOUND);
  }
  return handler(req, taskId, context);
}
