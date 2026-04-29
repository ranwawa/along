#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function logSection(title) {
  console.log(`\n==> ${title}`);
}

export function runCommand({ command, args, title, cwd }) {
  logSection(title);

  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

export function runGitText(args, allowFailure = false) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    if (allowFailure) {
      return '';
    }

    process.exit(result.status);
  }

  return result.stdout;
}

export function splitLines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function toAbsolutePath(file) {
  return path.resolve(process.cwd(), file);
}

export function isExistingFile(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}
