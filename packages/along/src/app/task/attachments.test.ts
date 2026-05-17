import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testPaths = vi.hoisted(() => ({
  root: '/tmp/along-task-attachments-test',
}));

vi.mock('../../core/config', () => ({
  config: {
    USER_ALONG_DIR: testPaths.root,
    getTaskDir: (owner: string, repo: string, taskId: string) =>
      `${testPaths.root}/${owner}/${repo}/tasks/${taskId}`,
  },
}));

vi.mock('../../core/db', () => ({
  getDb: () => ({ success: false, error: 'db not available in unit test' }),
}));

import {
  getTaskAttachmentAbsolutePath,
  prepareTaskImageAttachments,
} from './attachments';

describe('task-attachments', () => {
  beforeEach(() => {
    fs.rmSync(testPaths.root, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(testPaths.root, { recursive: true, force: true });
  });

  it('准备图片附件时，期望校验并写入 task attachments 目录', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
    const result = prepareTaskImageAttachments({
      task: {
        taskId: 'task-1',
        repoOwner: 'ranwawa',
        repoName: 'along',
      },
      uploads: [
        {
          originalName: 'screen.png',
          mimeType: 'image/png',
          bytes: pngBytes,
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      kind: 'image',
      originalName: 'screen.png',
      mimeType: 'image/png',
      sizeBytes: pngBytes.byteLength,
      relativePath: expect.stringMatching(/^attachments\/att_.+\.png$/),
    });
    expect(fs.existsSync(result.data[0].absolutePath)).toBe(true);
  });

  it('当图片 MIME 与内容不匹配时，期望返回中文错误且不写文件', () => {
    const result = prepareTaskImageAttachments({
      task: { taskId: 'task-1' },
      uploads: [
        {
          originalName: 'fake.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([0x00, 0x01, 0x02]),
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toBe('无法识别图片类型或图片 MIME 与内容不匹配');
    expect(fs.existsSync(testPaths.root)).toBe(false);
  });

  it('解析附件路径时，期望拒绝路径穿越', () => {
    const result = getTaskAttachmentAbsolutePath(
      { taskId: 'task-1' },
      '../secret.png',
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toBe('附件路径非法');
  });
});
