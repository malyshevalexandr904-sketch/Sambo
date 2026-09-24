import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен, чтобы в тестах работали декораторы NestJS с emitDecoratorMetadata.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    // Файлы выполняются по одному: интеграционные тесты делят одну базу и очищают её через TRUNCATE,
    // параллельный запуск даёт deadlock и чужие данные. Опция действует только на корневом уровне —
    // в конфигурации проекта vitest её игнорирует (и файлы идут параллельно, если ядер больше двух).
    fileParallelism: false,
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        plugins,
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
