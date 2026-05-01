#!/usr/bin/env bun

import { qualityConfig } from './config.mjs';
import { collectChangedFiles, createChangedQualityPlan } from './plan.mjs';
import { runTaskRef, runTaskRefsInSequence } from './tasks.mjs';

const changedFiles = collectChangedFiles();

if (changedFiles.length === 0) {
  console.log('当前工作区没有可校验的变更文件。');
  process.exit(0);
}

runTaskRef(qualityConfig.changedWorkspaceCheckTaskRef, changedFiles);

const plan = createChangedQualityPlan(changedFiles);

if (!plan.affectsPackages) {
  console.log('当前变更未影响需要执行包级校验的模块。');
  process.exit(0);
}

runTaskRefsInSequence(plan.prerequisiteTaskRefs);

for (const packageId of qualityConfig.packageExecutionOrder) {
  const packageConfig = qualityConfig.packages[packageId];
  const packagePlan = plan.packages[packageId];

  if (!packagePlan?.affected) {
    continue;
  }

  if (packageConfig.typecheckTaskRef) {
    runTaskRef(packageConfig.typecheckTaskRef);
  }

  if (packagePlan.runFullTests) {
    runTaskRef(packageConfig.fullTestsTaskRef);
    continue;
  }

  if (packagePlan.relatedInputs.length > 0) {
    runTaskRef(
      packageConfig.relatedTestsTaskRef || packageConfig.fullTestsTaskRef,
      packagePlan.relatedInputs,
    );
  }
}
