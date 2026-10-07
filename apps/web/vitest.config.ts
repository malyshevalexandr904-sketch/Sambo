import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Компоненты с JSX (без Next.js) проверяются через react-dom/server: новый JSX runtime, как в Next.
// `@/` — как в tsconfig (paths): модули интерфейса импортируют друг друга по этому префиксу.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
});
