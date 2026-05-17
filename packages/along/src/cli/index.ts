import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
/**
 * cli.ts - ALONG 自动化工具入口与命令分发
 */
import { config } from '../core/config';

const COMMAND_NAME_COLUMN_WIDTH = 25;

declare const Bun: {
  argv: [string, ...string[]];
  spawn(
    command: string[],
    options: { stdout: 'inherit'; stderr: 'inherit'; stdin: 'inherit' },
  ): { exited: Promise<number> };
};

/**
 * 展示帮助列表
 */
function printHelp(commands: string[], tag: string) {
  console.log('');
  console.log(chalk.bold.cyan(`${tag.toUpperCase()} 可用命令 (由 Bun 驱动):`));

  const descriptions: Record<string, string> = {
    'project-sync': '将 preset-assets 中的通用基建资产同步到目标项目',
  };

  for (const name of commands) {
    const desc = descriptions[name];
    if (desc) {
      console.log(`  ${name.padEnd(COMMAND_NAME_COLUMN_WIDTH)} - ${desc}`);
    }
  }

  console.log('');
  console.log(chalk.cyan('快速开始:'));
  console.log(`  along project-sync  # 同步基建资产`);
  console.log('');
}

/**
 * 分发子命令
 */
async function dispatch(
  subCommand: string,
  args: string[],
  commandsDir: string,
  commands: string[],
  tag: string,
) {
  const scriptPath = path.join(commandsDir, `${subCommand}.ts`);
  const watch = args.includes('--watch');
  const forwardedArgs = args.filter((arg) => arg !== '--watch');

  if (commands.includes(subCommand)) {
    const proc = Bun.spawn(
      [
        Bun.argv[0],
        ...(watch ? ['--watch'] : []),
        scriptPath,
        ...forwardedArgs,
      ],
      {
        stdout: 'inherit',
        stderr: 'inherit',
        stdin: 'inherit',
      },
    );
    process.exit(await proc.exited);
  } else if (subCommand === '--help' || subCommand === '-h') {
    printHelp(commands, tag);
  } else {
    console.error(chalk.red(`错误: 未知命令 "${subCommand}"`));
    process.exit(1);
  }
}

async function main() {
  config.ensureDataDirs();
  const commandsDir = path.join(config.SOURCE_DIR, 'cli/commands');
  const tagResult = config.getLogTag();
  const args = process.argv.slice(2);

  if (!fs.existsSync(commandsDir)) {
    console.error(`错误: commands 目录不存在: ${commandsDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.ts'));
  const commands = files.map((f) => f.replace('.ts', ''));

  const tag = tagResult.success ? tagResult.data : 'ALONG';

  if (args.length > 0) {
    await dispatch(args[0], args.slice(1), commandsDir, commands, tag);
  } else {
    printHelp(commands, tag);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
