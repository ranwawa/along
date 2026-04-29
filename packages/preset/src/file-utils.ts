import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GeneratedFile } from './types';

export function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeGeneratedFiles(
  projectDir: string,
  files: GeneratedFile[],
) {
  for (const file of files) {
    const targetPath = path.join(projectDir, file.path);
    ensureParentDir(targetPath);
    fs.writeFileSync(targetPath, file.content);

    if (file.content.startsWith('#!')) {
      fs.chmodSync(targetPath, 0o755);
    }
  }
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function collectFilesRecursively(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];

  walk(rootDir);
  return results.sort();

  function walk(currentDir: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
}
