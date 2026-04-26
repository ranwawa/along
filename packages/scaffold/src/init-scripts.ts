import consola from 'consola';
import fs from 'node:fs';
import path from 'node:path';

export function initScripts(cwd: string) {
  const log = consola.withTag('scaffold');

  const pkgPath = path.join(cwd, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.preinstall = 'bun bin/preinstall.ts';
  pkg.scripts.prepare = 'git config core.hooksPath .githooks';
  pkg.scripts.format = pkg.scripts.format || 'biome format --write .';
  pkg.scripts.lint = pkg.scripts.lint || 'biome lint .';
  pkg.scripts.check = pkg.scripts.check || 'biome check --write .';
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log.success('已更新 package.json scripts');
}
