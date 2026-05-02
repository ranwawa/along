import fs from 'node:fs';
import path from 'node:path';
import type {
  LoadedManagedProject,
  ManagedProjectConfig,
  ManagedProjectRootConfig,
  ManagedQualityConfig,
  ManagedQualityPackageConfig,
  ResolvedManagedProjectConfig,
  ResolvedManagedQualityConfig,
} from './types';

export const CONFIG_FILE_NAME = '.along/setting.json';
export const DEFAULT_ROOT_GATE_PREFIXES = [
  '.along/preset/',
  '.along/git-hooks/',
  '.github/',
];
export const DEFAULT_RELATED_INPUT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
export const DEFAULT_IGNORED_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
];

const LOCKFILE_INSTALL_COMMANDS: Array<[string, string]> = [
  ['bun.lock', 'bun install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
];

interface PackageJson {
  name?: string;
}

export function loadManagedProject(projectDir: string): LoadedManagedProject {
  const configPath = resolveConfigPath(projectDir);

  if (!configPath) {
    throw new Error(`未找到 ${CONFIG_FILE_NAME}: ${projectDir}`);
  }

  const rootConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf8'),
  ) as ManagedProjectRootConfig;
  const config = extractManagedProjectConfig(rootConfig, configPath);
  validateRequiredProjectConfig(config, configPath);
  const resolved = resolveManagedProjectConfig(projectDir, config);

  validateProjectConfig(config, resolved, configPath);

  return {
    configPath,
    projectDir,
    config,
    resolved,
    rootConfig,
  };
}

function resolveConfigPath(projectDir: string): string | null {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  return null;
}

function extractManagedProjectConfig(
  parsed: ManagedProjectRootConfig,
  configPath: string,
): ManagedProjectConfig {
  if ('distribution' in parsed && parsed.distribution) {
    return parsed.distribution;
  }

  throw new Error(`${configPath}: 缺少 distribution 配置`);
}

function validateProjectConfig(
  config: ManagedProjectConfig,
  resolved: ResolvedManagedProjectConfig,
  configPath: string,
) {
  validateRequiredProjectConfig(config, configPath);

  if (config.ci?.qualityGateAction?.enabled) {
    if (!resolved.tooling.installCommand) {
      throw new Error(`${configPath}: 缺少 tooling.installCommand`);
    }

    if (!resolved.tooling.bunVersionFile) {
      throw new Error(`${configPath}: 缺少 tooling.bunVersionFile`);
    }
  }
}

function validateRequiredProjectConfig(
  config: ManagedProjectConfig,
  configPath: string,
) {
  if (!config.agent?.editors?.length) {
    throw new Error(`${configPath}: agent.editors 不能为空`);
  }

  if (!config.quality?.changedWorkspaceCheckTaskRef) {
    throw new Error(`${configPath}: 缺少 quality.changedWorkspaceCheckTaskRef`);
  }

  if (
    !config.quality?.tasks ||
    Object.keys(config.quality.tasks).length === 0
  ) {
    throw new Error(`${configPath}: quality.tasks 不能为空`);
  }

  if (!config.quality?.packageExecutionOrder?.length) {
    throw new Error(`${configPath}: quality.packageExecutionOrder 不能为空`);
  }

  if (
    !config.quality?.packages ||
    Object.keys(config.quality.packages).length === 0
  ) {
    throw new Error(`${configPath}: quality.packages 不能为空`);
  }

  if (!config.quality?.fullSequence?.length) {
    throw new Error(`${configPath}: quality.fullSequence 不能为空`);
  }

  for (const packageId of config.quality.packageExecutionOrder) {
    if (!config.quality.packages[packageId]) {
      throw new Error(
        `${configPath}: quality.packageExecutionOrder 引用了未知包 ${packageId}`,
      );
    }
  }
}

export function resolveManagedProjectConfig(
  projectDir: string,
  config: ManagedProjectConfig,
): ResolvedManagedProjectConfig {
  const packageJson = readPackageJson(path.join(projectDir, 'package.json'));
  const packageName = packageJson.name || path.basename(projectDir);

  return {
    id: config.id || toProjectId(packageName),
    displayName: config.displayName || toDisplayName(packageName),
    presetVersion: readPresetVersion(),
    tooling: {
      installCommand:
        config.tooling?.installCommand || inferInstallCommand(projectDir),
      bunVersionFile:
        config.tooling?.bunVersionFile || inferBunVersionFile(projectDir),
    },
    quality: resolveQualityConfig(projectDir, config.quality),
    agent: config.agent,
    ...(config.ci ? { ci: config.ci } : {}),
  };
}

export function normalizeManagedProjectConfig(
  projectDir: string,
  config: ManagedProjectConfig,
): ManagedProjectConfig {
  const packageJson = readPackageJson(path.join(projectDir, 'package.json'));
  const packageName = packageJson.name || path.basename(projectDir);
  const tooling: Partial<ResolvedManagedProjectConfig['tooling']> = {};
  const normalizedQuality: ManagedQualityConfig = {
    ...config.quality,
  };
  const normalized: ManagedProjectConfig = {
    quality: normalizedQuality,
    agent: config.agent,
  };

  if (config.id && config.id !== toProjectId(packageName)) {
    normalized.id = config.id;
  }

  if (config.displayName && config.displayName !== toDisplayName(packageName)) {
    normalized.displayName = config.displayName;
  }

  if (
    config.tooling?.installCommand &&
    config.tooling.installCommand !== inferInstallCommand(projectDir)
  ) {
    tooling.installCommand = config.tooling.installCommand;
  }

  if (
    config.tooling?.bunVersionFile &&
    config.tooling.bunVersionFile !== inferBunVersionFile(projectDir)
  ) {
    tooling.bunVersionFile = config.tooling.bunVersionFile;
  }

  if (Object.keys(tooling).length > 0) {
    normalized.tooling = tooling;
  }

  if (
    isSameList(normalizedQuality.rootGateFiles, inferRootGateFiles(projectDir))
  ) {
    delete normalizedQuality.rootGateFiles;
  }

  if (
    isSameList(normalizedQuality.rootGatePrefixes, DEFAULT_ROOT_GATE_PREFIXES)
  ) {
    delete normalizedQuality.rootGatePrefixes;
  }

  if (normalizedQuality.changedPrerequisiteSequence?.length === 0) {
    delete normalizedQuality.changedPrerequisiteSequence;
  }

  for (const packageConfig of Object.values(normalizedQuality.packages)) {
    normalizePackageConfig(projectDir, packageConfig);
  }

  if (config.ci?.qualityGateAction?.enabled) {
    normalized.ci = {
      qualityGateAction: {
        enabled: true,
      },
    };
  }

  return normalized;
}

function normalizePackageConfig(
  projectDir: string,
  packageConfig: ManagedQualityPackageConfig,
) {
  if (
    packageConfig.displayName &&
    packageConfig.displayName ===
      inferPackageDisplayName(projectDir, packageConfig.path)
  ) {
    delete packageConfig.displayName;
  }

  if (
    isSameList(
      packageConfig.relatedInputExtensions,
      DEFAULT_RELATED_INPUT_EXTENSIONS,
    )
  ) {
    delete packageConfig.relatedInputExtensions;
  }

  if (isSameList(packageConfig.ignoredSuffixes, DEFAULT_IGNORED_SUFFIXES)) {
    delete packageConfig.ignoredSuffixes;
  }
}

function resolveQualityConfig(
  projectDir: string,
  quality: ManagedQualityConfig,
): ResolvedManagedQualityConfig {
  return {
    ...quality,
    rootGateFiles: quality.rootGateFiles || inferRootGateFiles(projectDir),
    rootGatePrefixes: quality.rootGatePrefixes || DEFAULT_ROOT_GATE_PREFIXES,
    changedPrerequisiteSequence: quality.changedPrerequisiteSequence || [],
  };
}

export function inferRootGateFiles(projectDir: string): string[] {
  const required = [CONFIG_FILE_NAME, 'biome.json', 'package.json'];
  const candidates = [
    '.bun-version',
    '.node-version',
    '.nvmrc',
    'biome.jsonc',
    'bun.lock',
    'bun.lockb',
    'tsconfig.json',
  ];

  return [
    ...required,
    ...candidates.filter((file) => fs.existsSync(path.join(projectDir, file))),
  ];
}

export function inferInstallCommand(projectDir: string): string {
  for (const [lockfile, command] of LOCKFILE_INSTALL_COMMANDS) {
    if (fs.existsSync(path.join(projectDir, lockfile))) {
      return command;
    }
  }

  return 'bun install';
}

export function inferBunVersionFile(projectDir: string): string {
  return fs.existsSync(path.join(projectDir, '.bun-version'))
    ? '.bun-version'
    : '.bun-version';
}

function inferPackageDisplayName(
  projectDir: string,
  packagePath: string,
): string | undefined {
  const packageJsonPath = path.join(projectDir, packagePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return undefined;
  }

  const packageJson = readPackageJson(packageJsonPath);
  return toDisplayName(packageJson.name || path.basename(packagePath));
}

export function readPresetVersion(): string {
  const packageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const packageJson = readPackageJson(packageJsonPath);

  return packageJson.version || '0.0.0';
}

export function toProjectId(value: string): string {
  return value
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function toDisplayName(value: string): string {
  return value.replace(/^@[^/]+\//, '');
}

function readPackageJson(filePath: string): PackageJson & { version?: string } {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isSameList(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
