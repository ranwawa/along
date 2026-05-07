import { ChatOpenAI } from '@langchain/openai';
import { consola } from 'consola';
import type { Result } from '../core/result';
import { failure, success } from '../core/result';
import {
  getProviderConfig,
  type ProviderConfig,
} from '../integration/agent-config';
import {
  type TaskPlanningSnapshot,
  updatePlanningTaskTitle,
} from './task-planning';

const logger = consola.withTag('task-title-summary');

const DEEPSEEK_PROVIDER_ID = 'deepseek';
const TITLE_MODEL_ENV = 'ALONG_TASK_TITLE_MODEL';
const TITLE_TIMEOUT_MS = 8000;
const TITLE_MAX_TOKENS = 256;

const SYSTEM_PROMPT = `你是 Along 的任务标题总结 Agent。
请根据用户的任务内容生成一个简短、准确、适合作为任务列表标题的中文标题。
只输出标题本身，不要解释，不要加引号，不要超过 20 个汉字。`;

export interface TaskTitleSummaryInput {
  taskId: string;
  body: string;
  attachmentCount?: number;
}

interface ResolvedTitleProvider {
  baseUrl: string;
  token: string;
  model: string;
}

function resolveTitleModel(provider: ProviderConfig): Result<string> {
  const models = provider.models || [];
  const override = process.env[TITLE_MODEL_ENV]?.trim();
  if (override) {
    return models.includes(override)
      ? success(override)
      : failure(
          `DeepSeek 标题模型 ${override} 不可用，已使用内容前 15 个字符作为标题`,
        );
  }

  const model = models[0]?.trim();
  return model
    ? success(model)
    : failure('DeepSeek 标题模型不可用，已使用内容前 15 个字符作为标题');
}

function resolveTitleProvider(): Result<ResolvedTitleProvider> {
  const provider = getProviderConfig(DEEPSEEK_PROVIDER_ID);
  if (!provider)
    return failure(
      '缺少 DeepSeek provider 配置，已使用内容前 15 个字符作为标题',
    );
  if (!provider.baseUrl)
    return failure(
      '缺少 DeepSeek baseUrl 配置，已使用内容前 15 个字符作为标题',
    );

  const token = provider?.token || process.env.DEEPSEEK_API_KEY;
  if (!token)
    return failure('缺少 DeepSeek token，已使用内容前 15 个字符作为标题');

  const modelRes = resolveTitleModel(provider);
  if (!modelRes.success) return modelRes;

  return success({
    baseUrl: provider.baseUrl,
    token,
    model: modelRes.data,
  });
}

function getTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
      ) {
        return part.text;
      }
      return '';
    })
    .join('');
}

function trimByChars(value: string, limit: number): string {
  return [...value].slice(0, limit).join('');
}

function normalizeGeneratedTitle(rawTitle: string): string {
  const title = rawTitle
    .replace(/^["'`“”‘’\s]+|["'`“”‘’\s]+$/g, '')
    .replace(/^标题[:：]\s*/, '')
    .split('\n')[0]
    .trim();
  return trimByChars(title, 30);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('标题生成超时')), timeoutMs);
    }),
  ]);
}

export async function generateTaskTitle(body: string): Promise<Result<string>> {
  const providerRes = resolveTitleProvider();
  if (!providerRes.success) return providerRes;

  try {
    const llm = new ChatOpenAI({
      model: providerRes.data.model,
      temperature: 0.2,
      maxTokens: TITLE_MAX_TOKENS,
      configuration: {
        baseURL: providerRes.data.baseUrl,
        apiKey: providerRes.data.token,
      },
    });

    const result = await withTimeout(
      llm.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: body.slice(0, 4000) },
      ]),
      TITLE_TIMEOUT_MS,
    );
    const title = normalizeGeneratedTitle(getTextContent(result.content));
    if (!title)
      return failure('标题生成结果为空，已使用内容前 15 个字符作为标题');
    return success(title);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`标题生成失败: ${message}`);
  }
}

export async function runTaskTitleSummary(
  input: TaskTitleSummaryInput,
): Promise<Result<TaskPlanningSnapshot | null>> {
  const body = input.attachmentCount
    ? `${input.body}\n\n[用户上传图片数量：${input.attachmentCount}]`
    : input.body;
  const titleRes = await generateTaskTitle(body);
  if (!titleRes.success) return titleRes;

  const updateRes = updatePlanningTaskTitle({
    taskId: input.taskId,
    title: titleRes.data,
  });
  if (!updateRes.success) return updateRes;

  logger.info(`[Task ${input.taskId}] 标题已自动总结更新`);
  return updateRes;
}
