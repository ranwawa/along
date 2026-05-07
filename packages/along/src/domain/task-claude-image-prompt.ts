import { readFileSync } from 'node:fs';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { InputImageAttachment } from './task-attachments';

type ClaudeImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export type ClaudePrompt = string | AsyncIterable<SDKUserMessage>;

export function buildClaudePrompt(
  prompt: string,
  images: InputImageAttachment[],
): ClaudePrompt {
  if (images.length === 0) return prompt;
  const message: SDKUserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mimeType as ClaudeImageMimeType,
            data: readFileSync(image.absolutePath).toString('base64'),
          },
        })),
      ],
    },
    parent_tool_use_id: null,
  };
  return (async function* () {
    yield message;
  })();
}
