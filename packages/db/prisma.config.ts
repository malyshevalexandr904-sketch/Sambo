import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// С prisma.config.ts Prisma не читает .env сама: локально подхватываем корневой .env монорепозитория.
const envFile = path.resolve(__dirname, '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx seed/index.ts',
  },
});
