// Валидация входа схемами из packages/contracts (ARCHITECTURE.md, 7). Неизвестные поля отбрасываются.
import { Body, Param, type PipeTransform, Query } from '@nestjs/common';
import { Uuid } from '@sde/contracts';
import type { z } from 'zod';
import { DomainError } from '../errors/domain-error';

export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(
    private readonly schema: S,
    private readonly pathPrefix = '',
    private readonly notFoundOnError = false,
  ) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    if (this.notFoundOnError) throw new DomainError('NOT_FOUND', { resource: 'route' });
    throw new DomainError('VALIDATION_FAILED', {
      fields: result.error.issues.map((i) => ({
        path: [this.pathPrefix, ...i.path.map(String)].filter(Boolean).join('.'),
        code: i.code === 'invalid_type' && value === undefined ? 'required' : i.message,
      })),
    });
  }
}

/** Тело запроса по схеме. Пустое тело трактуется как {}. */
export const ValidBody = (schema: z.ZodType): ParameterDecorator => Body(new ZodValidationPipe(schema));

export const ValidQuery = (schema: z.ZodType): ParameterDecorator => Query(new ZodValidationPipe(schema));

/** UUID из пути. Неверный формат → 404: для клиента это просто несуществующий ресурс. */
export const UuidParam = (name: string): ParameterDecorator =>
  Param(name, new ZodValidationPipe(Uuid, name, true));

export const ValidParam = (name: string, schema: z.ZodType): ParameterDecorator =>
  Param(name, new ZodValidationPipe(schema, name, true));
