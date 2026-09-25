import { defineConfig } from 'vitest/config';

// Компоненты с JSX (без Next.js) проверяются через react-dom/server: новый JSX runtime, как в Next.
export default defineConfig({ esbuild: { jsx: 'automatic' }, test: { include: ['src/**/*.test.ts'] } });
