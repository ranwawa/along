import { $ } from 'bun';
import type { Result } from './result';
import { failure, success } from './result';

let cached = '';

export async function readGhToken(): Promise<Result<string>> {
  if (cached) return success(cached);

  cached =
    process.env.GH_TOKEN ||
    process.env.ALONG_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    '';
  if (cached) return success(cached);

  try {
    cached = (await $`gh auth token`.text()).trim();
    return success(cached);
  } catch {
    return failure('未找到 GH_TOKEN 且 gh auth token 失败');
  }
}
