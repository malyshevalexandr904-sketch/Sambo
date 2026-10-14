import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Подготовка стенда нагрузочного теста (loadtest/README.md): не входит в обычные прогоны тестов.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/load/*.load.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 10 * 60_000,
    hookTimeout: 60_000,
  },
});
