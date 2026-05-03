import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const maxFileLines = 300;
const maxFunctionLines = 30;
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(packageRoot, 'src');
const functionStart =
  /^(export\s+)?(async\s+)?function\s+\w+|^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>/;

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function countLines(file) {
  return readFileSync(file, 'utf8').split('\n').length;
}

function findFunctionEnd(lines, start) {
  let depth = 0;
  let seenBody = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const char of lines[index]) {
      if (char === '{') {
        depth += 1;
        seenBody = true;
      } else if (char === '}') depth -= 1;
    }
    if (seenBody && depth <= 0) return index;
  }
  return start;
}

function checkFileLines(files) {
  return files.flatMap((file) => {
    const lineCount = countLines(file);
    if (lineCount <= maxFileLines) return [];
    return [
      `${relative(packageRoot, file)}: ${lineCount} 行，超过 ${maxFileLines} 行`,
    ];
  });
}

function checkFunctionLines(files) {
  return files
    .filter((file) => extname(file) === '.ts')
    .flatMap((file) => checkFileFunctionLines(file));
}

function checkFileFunctionLines(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  return lines.flatMap((line, index) => {
    if (!functionStart.test(line.trim())) return [];
    const length = findFunctionEnd(lines, index) - index + 1;
    if (length <= maxFunctionLines) return [];
    const name = line.trim();
    return [
      `${relative(packageRoot, file)}:${index + 1} ${length} 行，超过 ${maxFunctionLines} 行：${name}`,
    ];
  });
}

const files = listSourceFiles(sourceRoot);
const violations = [...checkFileLines(files), ...checkFunctionLines(files)];

if (violations.length > 0) {
  console.error(['along-web 代码体积检查失败：', ...violations].join('\n'));
  process.exit(1);
}

console.log('along-web 代码体积检查通过');
