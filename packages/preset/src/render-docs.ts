import { readText } from './file-utils';
import { getPresetTemplatePath } from './paths';
import type { LoadedManagedProject } from './types';

export function renderAgentsDoc(): string {
  return readText(getPresetTemplatePath('AGENTS.md'));
}

export function renderQualityGateAction(project: LoadedManagedProject): string {
  const config = project.resolved;

  return `name: Along Quality Gate
description: Shared quality gate maintained by along

inputs:
  bun-version-file:
    description: Bun version file path
    required: false
    default: ${config.tooling.bunVersionFile}
  install-command:
    description: Dependency installation command
    required: false
    default: ${config.tooling.installCommand}
  quality-command:
    description: Quality gate command
    required: false
    default: bun run quality:full

runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version-file: \${{ inputs.bun-version-file }}
    - shell: bash
      run: \${{ inputs.install-command }}
    - shell: bash
      run: \${{ inputs.quality-command }}
`;
}
