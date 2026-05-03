#!/usr/bin/env bun

import { qualityConfig } from './config.mjs';
import {
  isExistingFile,
  runGitText,
  splitLines,
  toAbsolutePath,
} from './utils.mjs';

const DEFAULT_RELATED_INPUT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
const DEFAULT_IGNORED_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
];

export function collectChangedFiles() {
  const stagedFiles = collectStagedFiles();

  if (stagedFiles.length > 0) {
    return stagedFiles;
  }

  const trackedChanges = [];
  const hasHead =
    runGitText(['rev-parse', '--verify', 'HEAD'], true).length > 0;

  if (hasHead) {
    trackedChanges.push(
      ...splitLines(
        runGitText(['diff', '--name-only', '--diff-filter=ACMRT', 'HEAD']),
      ),
    );
  } else {
    trackedChanges.push(
      ...splitLines(
        runGitText(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']),
      ),
    );
    trackedChanges.push(
      ...splitLines(runGitText(['diff', '--name-only', '--diff-filter=ACMRT'])),
    );
  }

  const untrackedFiles = splitLines(
    runGitText(['ls-files', '--others', '--exclude-standard'], true),
  );

  return normalizeFiles([...trackedChanges, ...untrackedFiles]);
}

function collectStagedFiles() {
  return normalizeFiles(
    splitLines(
      runGitText(
        ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'],
        true,
      ),
    ),
  );
}

function normalizeFiles(files) {
  return [...new Set(files)].filter(Boolean).filter(isExistingFile).sort();
}

export function createChangedQualityPlan(changedFiles) {
  const plan = {
    changedFiles,
    affectsPackages: false,
    prerequisiteTaskRefs: new Set(),
    packages: createInitialPackagePlans(),
  };

  for (const file of changedFiles) {
    if (isRootGateTrigger(file)) {
      plan.affectsPackages = true;
      markAllValidationPackagesForFullRun(plan);
      continue;
    }

    const matchedPackageId = findOwningPackageId(file);
    if (!matchedPackageId) {
      continue;
    }

    const matchedPackage = qualityConfig.packages[matchedPackageId];
    const validationTargets = resolveValidationTargets(matchedPackageId);

    if (validationTargets.length === 0) {
      continue;
    }

    plan.affectsPackages = true;
    addPrerequisiteTaskRefs(plan, validationTargets);

    if (isRelatedInput(matchedPackage, file)) {
      const absoluteFile = toAbsolutePath(file);

      for (const packageId of validationTargets) {
        plan.packages[packageId].affected = true;
        plan.packages[packageId].relatedInputs.add(absoluteFile);
      }

      continue;
    }

    for (const packageId of validationTargets) {
      plan.packages[packageId].affected = true;
      plan.packages[packageId].runFullTests = true;
    }
  }

  return normalizePlan(plan);
}

function createInitialPackagePlans() {
  const plans = {};

  for (const packageId of qualityConfig.packageExecutionOrder) {
    plans[packageId] = {
      affected: false,
      runFullTests: false,
      relatedInputs: new Set(),
    };
  }

  return plans;
}

function normalizePlan(plan) {
  const packages = {};

  for (const packageId of qualityConfig.packageExecutionOrder) {
    const packagePlan = plan.packages[packageId];

    packages[packageId] = {
      affected: packagePlan.affected,
      runFullTests: packagePlan.runFullTests,
      relatedInputs: [...packagePlan.relatedInputs].sort(),
    };
  }

  return {
    changedFiles: plan.changedFiles,
    affectsPackages: plan.affectsPackages,
    prerequisiteTaskRefs: [...plan.prerequisiteTaskRefs],
    packages,
  };
}

function isRootGateTrigger(file) {
  const rootGateFiles = qualityConfig.rootGateFiles || [];
  const rootGatePrefixes = qualityConfig.rootGatePrefixes || [];

  if (rootGateFiles.includes(file)) {
    return true;
  }

  return rootGatePrefixes.some((prefix) => file.startsWith(prefix));
}

function findOwningPackageId(file) {
  for (const [packageId, packageConfig] of Object.entries(
    qualityConfig.packages,
  )) {
    if (isFileInPackage(file, packageConfig.path)) {
      return packageId;
    }
  }

  return null;
}

function isFileInPackage(file, packagePath) {
  if (packagePath === '.' || packagePath === '') {
    return true;
  }

  return file === packagePath || file.startsWith(`${packagePath}/`);
}

function resolveValidationTargets(packageId) {
  const targets = new Set();
  const visited = new Set();

  walk(packageId);

  return qualityConfig.packageExecutionOrder.filter((target) =>
    targets.has(target),
  );

  function walk(currentId) {
    if (visited.has(currentId)) {
      return;
    }

    visited.add(currentId);

    const currentConfig = qualityConfig.packages[currentId];
    if (!currentConfig) {
      return;
    }

    if (qualityConfig.packageExecutionOrder.includes(currentId)) {
      targets.add(currentId);
    }

    for (const nextId of currentConfig.impactTargets || []) {
      walk(nextId);
    }
  }
}

function addPrerequisiteTaskRefs(plan, packageIds) {
  for (const packageId of packageIds) {
    const packageConfig = qualityConfig.packages[packageId];

    for (const taskRef of packageConfig.requiredTaskRefs || []) {
      plan.prerequisiteTaskRefs.add(taskRef);
    }
  }
}

function markAllValidationPackagesForFullRun(plan) {
  const allValidationPackages = qualityConfig.packageExecutionOrder;

  addPrerequisiteTaskRefs(plan, allValidationPackages);

  for (const packageId of allValidationPackages) {
    plan.packages[packageId].affected = true;
    plan.packages[packageId].runFullTests = true;
  }
}

function isRelatedInput(packageConfig, file) {
  const prefixes = packageConfig.relatedInputPrefixes || [];
  const extensions =
    packageConfig.relatedInputExtensions ?? DEFAULT_RELATED_INPUT_EXTENSIONS;
  const ignoredSuffixes =
    packageConfig.ignoredSuffixes ?? DEFAULT_IGNORED_SUFFIXES;

  if (
    prefixes.length > 0 &&
    !prefixes.some((prefix) => file.startsWith(prefix))
  ) {
    return false;
  }

  if (
    extensions.length > 0 &&
    !extensions.some((extension) => file.endsWith(extension))
  ) {
    return false;
  }

  if (ignoredSuffixes.some((suffix) => file.endsWith(suffix))) {
    return false;
  }

  return true;
}
