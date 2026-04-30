#!/usr/bin/env bun

import { syncProject } from '@ranwawa/preset';
import { Command } from 'commander';

const program = new Command();

program
  .name('along project-sync')
  .description('将 preset-assets 中的通用基建资产同步到目标项目')
  .argument('<project>', '项目路径或 preset-assets/projects.json 中的项目 id')
  .action(async (project) => {
    await syncProject(project);
  });

program.parse();
