import { Global, Module } from '@nestjs/common';
import { type Env, loadEnv } from '@sde/server-kit';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
