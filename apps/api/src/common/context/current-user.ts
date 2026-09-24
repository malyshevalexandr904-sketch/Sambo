import { createParamDecorator } from '@nestjs/common';
import { DomainError } from '../errors/domain-error';
import { type AuthUser, RequestContextStore } from './request-context';

/** Пользователь из проверенного токена. Никогда не берётся из тела запроса (PERMISSIONS.md, 6.1). */
export const CurrentUser = createParamDecorator((): AuthUser => {
  const user = RequestContextStore.current().user;
  if (!user) throw new DomainError('UNAUTHENTICATED');
  return user;
});
