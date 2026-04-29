#!/usr/bin/env node

import { qualityConfig } from './config.mjs';
import { runCommand } from './utils.mjs';

export function runTaskRef(taskRef, files = []) {
  if (!taskRef) {
    return;
  }

  const task = qualityConfig.tasks[taskRef];
  if (!task) {
    throw new Error(`未找到质量任务: ${taskRef}`);
  }

  const args = [...(task.args || [])];

  if (task.appendFiles && files.length > 0) {
    args.push(...files);
  }

  runCommand({
    command: task.command,
    args,
    cwd: task.cwd,
    title: task.title,
  });
}

export function runTaskRefsInSequence(requiredTaskRefs) {
  if (requiredTaskRefs.length === 0) {
    return;
  }

  const pending = new Set(requiredTaskRefs);

  for (const taskRef of qualityConfig.changedPrerequisiteSequence || []) {
    if (!pending.has(taskRef)) {
      continue;
    }

    runTaskRef(taskRef);
    pending.delete(taskRef);
  }

  for (const taskRef of [...pending].sort()) {
    runTaskRef(taskRef);
  }
}
