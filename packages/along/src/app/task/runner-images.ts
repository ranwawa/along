import type { Result } from '../../core/result';
import { success } from '../../core/result';
import type { TaskAgentProgressContext } from './agent-progress';
import { writeTaskAgentSessionEvent } from './agent-progress';
import type { InputImageAttachment } from './attachments';

export type LocalImagePromptItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

export async function resolveInputImagesIfNeeded(input: {
  taskId: string;
  inputArtifactIds?: string[];
}): Promise<Result<InputImageAttachment[]>> {
  if (!input.inputArtifactIds || input.inputArtifactIds.length === 0) {
    return success([]);
  }
  const { resolveInputImageAttachments } = await import('./attachment-read');
  return resolveInputImageAttachments(input);
}

export async function resolveAndRecordInputImages(input: {
  taskId: string;
  inputArtifactIds?: string[];
  context: TaskAgentProgressContext;
  summary: string;
}): Promise<Result<InputImageAttachment[]>> {
  const imagesRes = await resolveInputImagesIfNeeded(input);
  if (!imagesRes.success) return imagesRes;
  writeImageInputSessionEvent({
    context: input.context,
    images: imagesRes.data,
    summary: input.summary.replace('{count}', String(imagesRes.data.length)),
  });
  return imagesRes;
}

export function writeImageInputSessionEvent(input: {
  context: TaskAgentProgressContext;
  images: InputImageAttachment[];
  summary: string;
}) {
  if (input.images.length === 0) return;
  writeTaskAgentSessionEvent(
    input.context,
    'system',
    'message',
    input.summary,
    {
      type: 'input_images',
      count: input.images.length,
      files: input.images.map((image) => image.originalName),
    },
  );
}

export function buildLocalImagePromptInput(
  prompt: string,
  images: InputImageAttachment[],
): string | LocalImagePromptItem[] {
  if (images.length === 0) return prompt;
  return [
    { type: 'text', text: prompt },
    ...images.map(
      (image): LocalImagePromptItem => ({
        type: 'local_image',
        path: image.absolutePath,
      }),
    ),
  ];
}

export function appendImagePathsToPrompt(
  prompt: string,
  images: InputImageAttachment[],
): string {
  if (images.length === 0) return prompt;
  const lines = images.map(
    (image, index) =>
      `${index + 1}. ${image.originalName}: ${image.absolutePath}`,
  );
  return `${prompt}\n\n用户上传图片路径：\n${lines.join('\n')}`;
}
