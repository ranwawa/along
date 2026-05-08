import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryOption } from './api';
import {
  LAST_TASK_REPOSITORY_KEY,
  readLastRepository,
  resolveInitialRepository,
  writeLastRepository,
} from './useTaskPlanningState';

const repositories: RepositoryOption[] = [
  {
    fullName: 'ranwawa/along',
    owner: 'ranwawa',
    repo: 'along',
    path: '/workspace/along',
    isDefault: true,
  },
  {
    fullName: 'ranwawa/site',
    owner: 'ranwawa',
    repo: 'site',
    path: '/workspace/site',
    isDefault: false,
  },
];

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveInitialRepository', () => {
  it('有效缓存优先于服务端默认仓库', () => {
    expect(
      resolveInitialRepository(repositories, 'ranwawa/along', 'ranwawa/site'),
    ).toBe('ranwawa/site');
  });

  it('缓存仓库不存在时回退到默认仓库', () => {
    expect(
      resolveInitialRepository(repositories, 'ranwawa/along', 'missing/repo'),
    ).toBe('ranwawa/along');
  });

  it('写入和读取上次选择的仓库', () => {
    const store = stubLocalStorage();

    writeLastRepository('ranwawa/site');

    expect(store.get(LAST_TASK_REPOSITORY_KEY)).toBe('ranwawa/site');
    expect(readLastRepository()).toBe('ranwawa/site');
  });
});
