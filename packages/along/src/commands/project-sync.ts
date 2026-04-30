#!/usr/bin/env bun

import { syncProject } from '@ranwawa/preset';
import { Command } from 'commander';

const program = new Command();

program
  .name('along project-sync')
  .description('将 preset-assets 中的通用基建资产同步到目标项目')
  .argument('[project-path]', '项目路径', '.')
  .option('--yes', '缺少 distribution 时使用自动推断值初始化')
  .action(async (project, options: { yes?: boolean }) => {
    await syncProject(project, {
      yes: options.yes,
    });
  });

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
