import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { ResourceScope } from '../domain/grants';

export type ScopeResolverFn = (id: string | undefined, req: Request) => Promise<ResourceScope>;

/**
 * Реестр резолверов области. Модуль-владелец данных регистрирует резолвер для своих ресурсов
 * (organizations — «organization», competitions — «competition» с Phase 4).
 */
@Injectable()
export class ScopeResolverRegistry {
  private readonly resolvers = new Map<string, ScopeResolverFn>([
    ['platform', () => Promise.resolve({ kind: 'PLATFORM' })],
  ]);

  register(name: string, fn: ScopeResolverFn): void {
    if (this.resolvers.has(name)) throw new Error(`Scope resolver "${name}" is already registered`);
    this.resolvers.set(name, fn);
  }

  get(name: string): ScopeResolverFn {
    const fn = this.resolvers.get(name);
    if (!fn) throw new Error(`Scope resolver "${name}" is not registered`);
    return fn;
  }

  has(name: string): boolean {
    return this.resolvers.has(name);
  }
}
