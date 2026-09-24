// Ошибки домена (ARCHITECTURE.md, 9; ADR-16). Домен бросает только DomainError с кодом из каталога.
import { categoryOf, type ErrorCategory, type ErrorCode } from '@sde/contracts';

export class DomainError extends Error {
  readonly category: ErrorCategory;

  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
    this.category = categoryOf(code);
  }
}

export const notFound = (resource: string): DomainError => new DomainError('NOT_FOUND', { resource });

export const forbidden = (details?: Record<string, unknown>): DomainError =>
  new DomainError('FORBIDDEN', details);

export const invalidTransition = (from: string, to: string, allowed: readonly string[]): DomainError =>
  new DomainError('INVALID_TRANSITION', { from, to, allowed });

export const versionConflict = (currentVersion: number): DomainError =>
  new DomainError('VERSION_CONFLICT', { currentVersion });

export const validationFailed = (fields: { path: string; code: string }[]): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields });
