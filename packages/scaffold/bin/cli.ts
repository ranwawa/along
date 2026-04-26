#!/usr/bin/env bun
import { Command } from 'commander';
import { initBiome } from '../src/init-biome';

const program = new Command();

program.name('scaffold').description('一键初始化项目工程规范').version('0.0.1');

program
  .command('init')
  .description('初始化 Biome + Git Hooks（格式化、Lint、pre-commit 检查）')
  .action(async () => {
    await initBiome();
  });

program.parse();
