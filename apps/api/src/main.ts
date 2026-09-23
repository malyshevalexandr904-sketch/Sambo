import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InvalidEnvironmentError, type Env } from '@sde/server-kit';
import { assertEnvironment, AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV } from './config/config.module';

async function main(): Promise<void> {
  try {
    assertEnvironment();
  } catch (e) {
    if (e instanceof InvalidEnvironmentError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app, { useLogger: true });
  const env = app.get<Env>(ENV);
  await app.listen(env.API_PORT, '0.0.0.0');
}

void main();
