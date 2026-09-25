import { defineConfig } from 'vitest/config';

// Интеграционные тесты делят базу с тестами api: файлы — по одному (см. apps/api/vitest.config.ts).
export default defineConfig({
  test: {
    fileParallelism: false,
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.e2e.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
