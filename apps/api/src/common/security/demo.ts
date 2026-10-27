// Демо-вход (правки 27.10.2026): общая учётная запись «только просмотр». Любой запрос, меняющий данные, отклоняется
// с DEMO_READ_ONLY; открыты только чтение, публичные маршруты (вход, регистрация) и помеченные @DemoAllowed
// (выход, переключение роли кабинета — это просмотр, а не действие).
import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROUTE_ACCESS, type RouteAccess } from '../../modules/access/api/decorators';
import { RequestContextStore } from '../context/request-context';
import { DomainError } from '../errors/domain-error';

const DEMO_ALLOWED = 'sde:demo-allowed';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Маршрут доступен и в демо-режиме, хотя меняет состояние сессии. */
export const DemoAllowed = (): MethodDecorator => SetMetadata(DEMO_ALLOWED, true);

@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const user = RequestContextStore.current().user;
    if (!user?.demo) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (READ_METHODS.has(req.method.toUpperCase())) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(DEMO_ALLOWED, targets)) return true;
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, targets);
    if (access?.kind === 'public') return true;
    throw new DomainError('DEMO_READ_ONLY');
  }
}
