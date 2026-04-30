import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // 每个测试文件独立环境，避免模块缓存导致 mock 泄漏
    isolate: true,
  },
});
