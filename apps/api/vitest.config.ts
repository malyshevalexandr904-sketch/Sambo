import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC нужен, чтобы в тестах работали декораторы NestJS с emitDecoratorMetadata.
const plugins = [swc.vite({ module: { type: 'es6' } })];

export default defineConfig({
  test: {
    projects: [
      { plugins, test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node' } },
      {
        plugins,
        test: {
          name: 'integration',
          include: ['test/**/*.e2e.test.ts'],
          environment: 'node',
          globalSetup: ['test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
