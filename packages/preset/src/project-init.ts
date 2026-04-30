import fs from 'node:fs';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import consola from 'consola';
import { CONFIG_FILE_NAME } from './project-config';
import type {
  ManagedAgentEditor,
  ManagedProjectConfig,
  ManagedProjectRootConfig,
  ManagedQualityConfig,
  ManagedQualityPackageConfig,
  ManagedQualityTaskConfig,
} from './types';

const logger = consola.withTag('preset-init');

const EDITOR_OPTIONS: ManagedAgentEditor[] = [
  'codex',
  'claude',
  'opencode',
  'pi',
];

const EDITOR_DETECT_DIRS: Record<ManagedAgentEditor, string> = {
  opencode: '.opencode',
  pi: '.pi',
  codex: '.codex',
  claude: '.claude',
};

const LOCKFILE_INSTALL_COMMANDS: Array<[string, string]> = [
  ['bun.lock', 'bun install --frozen-lockfile'],
  ['bun.lockb', 'bun install --frozen-lockfile'],
];

type QualityTemplate = 'single' | 'workspace';

interface InitProjectOptions {
  yes?: boolean;
  interactive?: boolean;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
  engines?: {
    node?: string;
  };
}

interface ProjectPackage {
  id: string;
  displayName: string;
  path: string;
  scripts: Record<string, string>;
}

interface ProjectSnapshot {
  projectDir: string;
  rootConfig: ManagedProjectRootConfig;
  packageJson: PackageJson;
  packageName: string;
  defaultTemplate: QualityTemplate;
}

export async function ensureManagedProjectConfig(
  projectDir: string,
  options: InitProjectOptions = {},
): Promise<boolean> {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);
  const rootConfig = readRootConfig(configPath);

  if (rootConfig.distribution) {
    return false;
  }

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY);

  if (!interactive && !options.yes) {
    throw new Error(
      `未找到 ${CONFIG_FILE_NAME}.distribution。非交互环境请使用 --yes 自动初始化，或先手动补充 distribution 配置。`,
    );
  }

  const snapshot = createProjectSnapshot(projectDir, rootConfig);
  const distribution = options.yes
    ? buildManagedProjectConfig(snapshot, snapshot.defaultTemplate)
    : await promptManagedProjectConfig(snapshot);

  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ ...rootConfig, distribution }, null, 2)}\n`,
  );
  logger.success(`已写入 ${CONFIG_FILE_NAME}.distribution`);

  return true;
}

function readRootConfig(configPath: string): ManagedProjectRootConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function createProjectSnapshot(
  projectDir: string,
  rootConfig: ManagedProjectRootConfig,
): ProjectSnapshot {
  const packageJson = readPackageJson(path.join(projectDir, 'package.json'));
  const packageName = packageJson.name || path.basename(projectDir);
  const workspacePackages = collectWorkspacePackages(projectDir, packageJson);

  return {
    projectDir,
    rootConfig,
    packageJson,
    packageName,
    defaultTemplate: workspacePackages.length > 0 ? 'workspace' : 'single',
  };
}

async function promptManagedProjectConfig(
  snapshot: ProjectSnapshot,
): Promise<ManagedProjectConfig> {
  logger.info(`未找到 ${CONFIG_FILE_NAME}.distribution，开始初始化分发配置。`);

  const rl = createInterface({ input, output });

  try {
    const template = await askSelect<QualityTemplate>(
      rl,
      '请选择质量门禁模板',
      [
        {
          value: 'workspace',
          label: 'Workspace 项目',
        },
        {
          value: 'single',
          label: '单包项目',
        },
      ],
      snapshot.defaultTemplate,
    );
    const defaults = buildManagedProjectConfig(snapshot, template);

    return {
      ...defaults,
      id: await askText(rl, '项目 ID', defaults.id),
      displayName: await askText(rl, '项目显示名称', defaults.displayName),
      projectDocPath: await askText(
        rl,
        '项目专属文档路径',
        defaults.projectDocPath,
      ),
      tooling: {
        ...defaults.tooling,
        nodeVersion: await askText(
          rl,
          'GitHub Action Node.js 版本',
          defaults.tooling.nodeVersion,
        ),
        bunVersionFile: await askText(
          rl,
          'Bun 版本文件路径',
          defaults.tooling.bunVersionFile,
        ),
        installCommand: await askText(
          rl,
          '依赖安装命令',
          defaults.tooling.installCommand,
        ),
      },
      agent: {
        editors: await askMultiSelect(
          rl,
          '请选择需要同步 prompts/skills 的编辑器',
          EDITOR_OPTIONS.map((editor) => ({
            value: editor,
            label: editor,
          })),
          defaults.agent.editors,
        ),
      },
      ci: {
        qualityGateAction: {
          enabled: await askYesNo(
            rl,
            '是否生成 GitHub Action 质量门禁',
            Boolean(defaults.ci?.qualityGateAction?.enabled),
          ),
        },
      },
    };
  } finally {
    rl.close();
  }
}

function buildManagedProjectConfig(
  snapshot: ProjectSnapshot,
  template: QualityTemplate,
): ManagedProjectConfig {
  return {
    id: toProjectId(snapshot.packageName),
    displayName: toDisplayName(snapshot.packageName),
    presetVersion: readPresetVersion(),
    projectDocPath: inferProjectDocPath(snapshot.projectDir),
    cleanupPaths: [],
    tooling: {
      packageManager: 'bun',
      installCommand: inferInstallCommand(snapshot.projectDir),
      nodeVersion: inferNodeVersion(snapshot.projectDir, snapshot.packageJson),
      bunVersionFile: inferBunVersionFile(snapshot.projectDir),
    },
    quality: buildQualityConfig(snapshot, template),
    agent: {
      editors: inferEditors(snapshot.projectDir, snapshot.rootConfig),
    },
    ci: {
      qualityGateAction: {
        enabled: fs.existsSync(path.join(snapshot.projectDir, '.github')),
      },
    },
  };
}

function buildQualityConfig(
  snapshot: ProjectSnapshot,
  template: QualityTemplate,
): ManagedQualityConfig {
  const tasks: Record<string, ManagedQualityTaskConfig> = {
    'workspace:changed': {
      title: '检查变更文件格式',
      command: 'bunx',
      args: ['biome', 'check', '--write', '--no-errors-on-unmatched'],
      appendFiles: true,
    },
    'workspace:full': {
      title: '检查全量代码格式',
      command: 'bunx',
      args: ['biome', 'check', '.'],
    },
  };
  const packages = collectProjectPackages(snapshot, template);
  const qualityPackages: Record<string, ManagedQualityPackageConfig> = {};
  const fullSequence = new Set<string>(['workspace:full']);

  addRootScriptTask(snapshot.packageJson, tasks, fullSequence, 'check');
  addRootScriptTask(snapshot.packageJson, tasks, fullSequence, 'lint');

  if (template === 'workspace') {
    addRootScriptTask(snapshot.packageJson, tasks, fullSequence, 'typecheck');
    addRootScriptTask(snapshot.packageJson, tasks, fullSequence, 'test');
  }

  for (const projectPackage of packages) {
    qualityPackages[projectPackage.id] = createQualityPackageConfig(
      projectPackage,
      tasks,
      fullSequence,
    );
  }

  return {
    rootGateFiles: inferRootGateFiles(snapshot.projectDir),
    rootGatePrefixes: ['.along/preset/', '.github/', '.ranwawa/'],
    changedWorkspaceCheckTaskRef: 'workspace:changed',
    changedPrerequisiteSequence: [],
    fullSequence: [...fullSequence],
    packageExecutionOrder: packages.map((projectPackage) => projectPackage.id),
    tasks,
    packages: qualityPackages,
  };
}

function createQualityPackageConfig(
  projectPackage: ProjectPackage,
  tasks: Record<string, ManagedQualityTaskConfig>,
  fullSequence: Set<string>,
): ManagedQualityPackageConfig {
  const taskPrefix = projectPackage.id;
  const typecheckTaskRef = addPackageScriptTask(
    projectPackage,
    tasks,
    fullSequence,
    taskPrefix,
    'typecheck',
  );
  const fullTestsTaskRef =
    addPackageScriptTask(
      projectPackage,
      tasks,
      fullSequence,
      taskPrefix,
      'test:coverage',
      'coverage',
    ) ||
    addPackageScriptTask(
      projectPackage,
      tasks,
      fullSequence,
      taskPrefix,
      'coverage',
    ) ||
    addPackageScriptTask(
      projectPackage,
      tasks,
      fullSequence,
      taskPrefix,
      'test',
    );
  const relatedTestsTaskRef =
    addPackageScriptTask(
      projectPackage,
      tasks,
      undefined,
      taskPrefix,
      'test:related',
      'related-tests',
      true,
    ) || undefined;

  return {
    displayName: projectPackage.displayName,
    path: projectPackage.path,
    ...(projectPackage.path === '.'
      ? {}
      : { relatedInputPrefixes: [projectPackage.path] }),
    relatedInputExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    ignoredSuffixes: ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'],
    ...(typecheckTaskRef ? { typecheckTaskRef } : {}),
    ...(relatedTestsTaskRef ? { relatedTestsTaskRef } : {}),
    ...(fullTestsTaskRef ? { fullTestsTaskRef } : {}),
    ...(fullTestsTaskRef?.endsWith(':coverage')
      ? { coverageTaskRef: fullTestsTaskRef }
      : {}),
  };
}

function addRootScriptTask(
  packageJson: PackageJson,
  tasks: Record<string, ManagedQualityTaskConfig>,
  fullSequence: Set<string>,
  scriptName: string,
) {
  if (!packageJson.scripts?.[scriptName]) {
    return;
  }

  const taskRef = `workspace:${scriptName}`;
  tasks[taskRef] = {
    title: `执行根项目 ${scriptName}`,
    command: 'bun',
    args: ['run', scriptName],
  };
  fullSequence.add(taskRef);
}

function addPackageScriptTask(
  projectPackage: ProjectPackage,
  tasks: Record<string, ManagedQualityTaskConfig>,
  fullSequence: Set<string> | undefined,
  taskPrefix: string,
  scriptName: string,
  taskName = scriptName,
  appendFiles = false,
): string | undefined {
  if (!projectPackage.scripts[scriptName]) {
    return undefined;
  }

  const taskRef = `${taskPrefix}:${taskName}`;
  tasks[taskRef] = {
    title: `执行 ${projectPackage.displayName} ${scriptName}`,
    command: 'bun',
    args: ['run', scriptName],
    cwd: projectPackage.path,
    ...(appendFiles ? { appendFiles: true } : {}),
  };
  fullSequence?.add(taskRef);

  return taskRef;
}

function collectProjectPackages(
  snapshot: ProjectSnapshot,
  template: QualityTemplate,
): ProjectPackage[] {
  if (template === 'workspace') {
    const workspacePackages = collectWorkspacePackages(
      snapshot.projectDir,
      snapshot.packageJson,
    );

    if (workspacePackages.length > 0) {
      return workspacePackages;
    }
  }

  return [
    {
      id: 'root',
      displayName: toDisplayName(snapshot.packageName),
      path: '.',
      scripts: snapshot.packageJson.scripts || {},
    },
  ];
}

function collectWorkspacePackages(
  projectDir: string,
  packageJson: PackageJson,
): ProjectPackage[] {
  const patterns = getWorkspacePatterns(packageJson);
  const packages: ProjectPackage[] = [];

  for (const packageDir of expandWorkspacePatterns(projectDir, patterns)) {
    const packageJsonPath = path.join(projectDir, packageDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const workspacePackageJson = readPackageJson(packageJsonPath);
    const packageName =
      workspacePackageJson.name ||
      path.basename(path.join(projectDir, packageDir));

    packages.push({
      id: toProjectId(packageName),
      displayName: toDisplayName(packageName),
      path: packageDir,
      scripts: workspacePackageJson.scripts || {},
    });
  }

  return packages.sort((left, right) => left.path.localeCompare(right.path));
}

function getWorkspacePatterns(packageJson: PackageJson): string[] {
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  return packageJson.workspaces?.packages || [];
}

function expandWorkspacePatterns(
  projectDir: string,
  patterns: string[],
): string[] {
  const results = new Set<string>();

  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      continue;
    }

    const parent = pattern.slice(0, -2);
    const parentDir = path.join(projectDir, parent);

    if (!fs.existsSync(parentDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        results.add(path.join(parent, entry.name));
      }
    }
  }

  return [...results].sort();
}

function inferRootGateFiles(projectDir: string): string[] {
  const required = ['.along.json', 'package.json'];
  const candidates = [
    '.bun-version',
    '.node-version',
    '.nvmrc',
    'biome.json',
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

function inferProjectDocPath(projectDir: string): string {
  if (fs.existsSync(path.join(projectDir, 'PROJECT.md'))) {
    return 'PROJECT.md';
  }

  if (fs.existsSync(path.join(projectDir, 'README.md'))) {
    return 'README.md';
  }

  return 'PROJECT.md';
}

function inferInstallCommand(projectDir: string): string {
  for (const [lockfile, command] of LOCKFILE_INSTALL_COMMANDS) {
    if (fs.existsSync(path.join(projectDir, lockfile))) {
      return command;
    }
  }

  return 'bun install';
}

function inferNodeVersion(
  projectDir: string,
  packageJson: PackageJson,
): string {
  for (const versionFile of ['.node-version', '.nvmrc']) {
    const filePath = path.join(projectDir, versionFile);

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim();
    }
  }

  return packageJson.engines?.node?.replace(/^[^\d]*/, '') || '20';
}

function inferBunVersionFile(projectDir: string): string {
  return fs.existsSync(path.join(projectDir, '.bun-version'))
    ? '.bun-version'
    : '.bun-version';
}

function inferEditors(
  projectDir: string,
  rootConfig: ManagedProjectRootConfig,
): ManagedAgentEditor[] {
  const detected = new Set<ManagedAgentEditor>();
  const configuredEditor = normalizeEditor(
    process.env.AGENT_TYPE || rootConfig.agent,
  );

  if (configuredEditor) {
    detected.add(configuredEditor);
  }

  for (const editor of EDITOR_OPTIONS) {
    if (fs.existsSync(path.join(projectDir, EDITOR_DETECT_DIRS[editor]))) {
      detected.add(editor);
    }
  }

  return detected.size > 0 ? [...detected] : ['codex'];
}

function normalizeEditor(value: string | undefined): ManagedAgentEditor | null {
  if (!value) {
    return null;
  }

  if (value === 'kira') {
    return 'claude';
  }

  return EDITOR_OPTIONS.includes(value as ManagedAgentEditor)
    ? (value as ManagedAgentEditor)
    : null;
}

function readPackageJson(filePath: string): PackageJson {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readPresetVersion(): string {
  const packageJsonPath = path.resolve(import.meta.dirname, '../package.json');
  const packageJson = readPackageJson(packageJsonPath);

  return packageJson.version || '0.0.0';
}

function toProjectId(value: string): string {
  return value
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toDisplayName(value: string): string {
  return value.replace(/^@[^/]+\//, '');
}

async function askText(
  rl: Interface,
  question: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`${question} (${defaultValue}): `);

  return answer.trim() || defaultValue;
}

async function askYesNo(
  rl: Interface,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}]: `))
    .trim()
    .toLowerCase();

  if (!answer) {
    return defaultValue;
  }

  return ['y', 'yes', '是'].includes(answer);
}

async function askSelect<T extends string>(
  rl: Interface,
  question: string,
  options: Array<{ value: T; label: string }>,
  defaultValue: T,
): Promise<T> {
  console.log(question);

  options.forEach((option, index) => {
    const marker = option.value === defaultValue ? ' *' : '';
    console.log(`  ${index + 1}. ${option.label}${marker}`);
  });

  const answer = await rl.question(`请输入编号，默认 ${defaultValue}: `);
  const index = Number.parseInt(answer.trim(), 10);

  if (!Number.isInteger(index) || index < 1 || index > options.length) {
    return defaultValue;
  }

  return options[index - 1].value;
}

async function askMultiSelect<T extends string>(
  rl: Interface,
  question: string,
  options: Array<{ value: T; label: string }>,
  defaultValues: T[],
): Promise<T[]> {
  const defaultValueSet = new Set(defaultValues);
  console.log(question);

  options.forEach((option, index) => {
    const marker = defaultValueSet.has(option.value) ? ' *' : '';
    console.log(`  ${index + 1}. ${option.label}${marker}`);
  });

  const answer = await rl.question(
    `请输入编号，多个用逗号分隔，默认 ${defaultValues.join(',')}: `,
  );
  const selectedIndexes = answer
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));

  if (selectedIndexes.length === 0) {
    return defaultValues;
  }

  const selectedValues = selectedIndexes
    .filter((index) => index >= 1 && index <= options.length)
    .map((index) => options[index - 1].value);

  return selectedValues.length > 0 ? selectedValues : defaultValues;
}
