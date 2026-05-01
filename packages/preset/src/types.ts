export type ManagedAgentEditor = 'opencode' | 'pi' | 'codex' | 'claude';

export interface ManagedProjectTooling {
  installCommand: string;
  bunVersionFile: string;
}

export interface ManagedCoverageThresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

export interface ManagedQualityTaskConfig {
  title: string;
  command: string;
  args?: string[];
  cwd?: string;
  appendFiles?: boolean;
}

export interface ManagedQualityPackageConfig {
  displayName?: string;
  path: string;
  impactTargets?: string[];
  requiredTaskRefs?: string[];
  relatedInputPrefixes?: string[];
  relatedInputExtensions?: string[];
  ignoredSuffixes?: string[];
  typecheckTaskRef?: string;
  relatedTestsTaskRef?: string;
  fullTestsTaskRef?: string;
  coverageTaskRef?: string;
  coverageThresholds?: ManagedCoverageThresholds;
}

export interface ManagedQualityConfig {
  rootGateFiles?: string[];
  rootGatePrefixes?: string[];
  changedWorkspaceCheckTaskRef: string;
  changedPrerequisiteSequence?: string[];
  fullSequence: string[];
  packageExecutionOrder: string[];
  tasks: Record<string, ManagedQualityTaskConfig>;
  packages: Record<string, ManagedQualityPackageConfig>;
}

export interface ManagedAgentConfig {
  editors: ManagedAgentEditor[];
}

export interface ManagedCiQualityGateActionConfig {
  enabled: boolean;
}

export interface ManagedCiConfig {
  qualityGateAction?: ManagedCiQualityGateActionConfig;
}

export interface ManagedProjectConfig {
  id?: string;
  displayName?: string;
  cleanupPaths?: string[];
  tooling?: Partial<ManagedProjectTooling>;
  quality: ManagedQualityConfig;
  agent: ManagedAgentConfig;
  ci?: ManagedCiConfig;
}

export interface ResolvedManagedQualityConfig
  extends Omit<
    ManagedQualityConfig,
    'rootGateFiles' | 'rootGatePrefixes' | 'changedPrerequisiteSequence'
  > {
  rootGateFiles: string[];
  rootGatePrefixes: string[];
  changedPrerequisiteSequence: string[];
}

export interface ResolvedManagedProjectConfig
  extends Omit<
    ManagedProjectConfig,
    'id' | 'displayName' | 'cleanupPaths' | 'tooling' | 'quality'
  > {
  id: string;
  displayName: string;
  presetVersion: string;
  cleanupPaths: string[];
  tooling: ManagedProjectTooling;
  quality: ResolvedManagedQualityConfig;
}

export interface ManagedProjectRootConfig {
  agent?: string;
  distribution?: ManagedProjectConfig;
}

export interface LoadedManagedProject {
  configPath: string;
  projectDir: string;
  config: ManagedProjectConfig;
  resolved: ResolvedManagedProjectConfig;
  rootConfig: ManagedProjectRootConfig;
}

export interface GeneratedFile {
  path: string;
  content: string;
}
