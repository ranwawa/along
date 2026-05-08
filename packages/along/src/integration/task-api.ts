import type { TaskPlanningSnapshot } from '../domain/task-planning';
import {
  handleTaskApproveRequest,
  handleTaskAttachmentRequest,
  handleTaskCloseRequest,
  handleTaskCompleteRequest,
  handleTaskCreateRequest,
  handleTaskDeliveryRequest,
  handleTaskGetRequest,
  handleTaskImplementationRequest,
  handleTaskListRequest,
  handleTaskManualCompleteRequest,
  handleTaskMessageRequest,
  handleTaskPlannerRequest,
} from './task-api-handlers';
import { errorResponse } from './task-api-utils';

export interface ScheduledTaskPlanningRun {
  taskId: string;
  cwd: string;
  reason: 'task_created' | 'user_message' | 'manual' | 'autonomous';
  agentId?: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface ScheduledTaskImplementationRun {
  taskId: string;
  cwd: string;
  reason: 'manual' | 'autonomous';
  agentId?: string;
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface ScheduledTaskDeliveryRun {
  taskId: string;
  cwd: string;
  reason: 'manual' | 'autonomous';
}

export interface ScheduledTaskTitleSummaryRun {
  taskId: string;
  body: string;
  attachmentCount?: number;
}

export interface TaskApiContext {
  defaultCwd: string;
  schedulePlanner?: (input: ScheduledTaskPlanningRun) => void;
  scheduleImplementation?: (input: ScheduledTaskImplementationRun) => void;
  scheduleDelivery?: (input: ScheduledTaskDeliveryRun) => void;
  scheduleTitleSummary?: (input: ScheduledTaskTitleSummaryRun) => void;
  resolveRepoPath?: (owner: string, repo: string) => string | undefined;
  resolveRepositoryForPath?: (
    cwd: string,
  ) => Pick<TaskPlanningSnapshot['task'], 'repoOwner' | 'repoName'> | undefined;
}

type TaskActionHandler = (
  req: Request,
  taskId: string,
  context: TaskApiContext,
) => Response | Promise<Response>;

const ACTION_ROUTES: Record<string, TaskActionHandler> = {
  approve: (_req, taskId) => handleTaskApproveRequest(taskId),
  close: (req, taskId) => handleTaskCloseRequest(req, taskId),
  complete: (_req, taskId, context) =>
    handleTaskCompleteRequest(taskId, context),
  delivery: handleTaskDeliveryRequest,
  implementation: handleTaskImplementationRequest,
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
  if (!taskId) return errorResponse('缺少 taskId', 404);
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
  return errorResponse('未找到 Task API', 404);
}

function handleTaskActionRequest(
  req: Request,
  taskId: string,
  action: string | undefined,
  context: TaskApiContext,
): Response | Promise<Response> {
  const handler = action ? ACTION_ROUTES[action] : undefined;
  if (!handler || req.method !== 'POST') {
    return errorResponse('未找到 Task API', 404);
  }
  return handler(req, taskId, context);
}
