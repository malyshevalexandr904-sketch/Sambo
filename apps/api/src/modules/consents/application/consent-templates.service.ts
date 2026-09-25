// Тексты согласий (API.md, 4.2; ФЗ-152): версия по виду и языку, после публикации текст неизменяем
// (триггер в БД). Публикация новой версии выводит из обращения прежнюю: новые согласия даются на новый текст,
// данные ранее согласия остаются действующими.
import { Injectable } from '@nestjs/common';
import type {
  ConsentTemplateCreate,
  ConsentTemplateDto,
  ConsentTemplatePatch,
  ConsentTemplatesQuery,
} from '@sde/contracts';
import { type ConsentTemplate, uuidv7 } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';

export function templateDto(t: ConsentTemplate): ConsentTemplateDto {
  return {
    id: t.id,
    kind: t.kind,
    version: t.version,
    locale: t.locale === 'en' ? 'en' : 'ru',
    operatorName: t.operatorName,
    bodyMarkdown: t.bodyMarkdown,
    status: t.retiredAt ? 'RETIRED' : t.publishedAt ? 'PUBLISHED' : 'DRAFT',
    publishedAt: t.publishedAt?.toISOString() ?? null,
    retiredAt: t.retiredAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}

@Injectable()
export class ConsentTemplatesService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Действующие тексты: опубликованы и не выведены из обращения. */
  async published(q: ConsentTemplatesQuery): Promise<ConsentTemplateDto[]> {
    const rows = await this.db.consentTemplate.findMany({
      where: { kind: q.kind, locale: q.locale, publishedAt: { not: null }, retiredAt: null },
      orderBy: [{ kind: 'asc' }, { locale: 'asc' }],
    });
    return rows.map(templateDto);
  }

  async all(q: ConsentTemplatesQuery): Promise<ConsentTemplateDto[]> {
    const rows = await this.db.consentTemplate.findMany({
      where: { kind: q.kind, locale: q.locale },
      orderBy: [{ kind: 'asc' }, { locale: 'asc' }, { version: 'desc' }],
    });
    return rows.map(templateDto);
  }

  async create(input: ConsentTemplateCreate, actorId: string): Promise<ConsentTemplateDto> {
    return this.db.tx(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consent_template:${input.kind}:${input.locale}`}))`;
      const last = await tx.consentTemplate.findFirst({
        where: { kind: input.kind, locale: input.locale },
        orderBy: { version: 'desc' },
      });
      const created = await tx.consentTemplate.create({
        data: { id: uuidv7(), ...input, version: (last?.version ?? 0) + 1, createdById: actorId },
      });
      await this.audit.record(tx, {
        action: 'consent_template.created',
        entityType: 'ConsentTemplate',
        entityId: created.id,
        after: { kind: created.kind, locale: created.locale, version: created.version },
      });
      return templateDto(created);
    });
  }

  async update(id: string, patch: ConsentTemplatePatch): Promise<ConsentTemplateDto> {
    return this.db.tx(async (tx) => {
      const current = await tx.consentTemplate.findUnique({ where: { id } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'consent_template' });
      if (current.publishedAt)
        throw new DomainError('INVALID_TRANSITION', { from: 'PUBLISHED', to: 'DRAFT', allowed: [] });
      const updated = await tx.consentTemplate.update({ where: { id }, data: patch });
      await this.audit.record(tx, {
        action: 'consent_template.updated',
        entityType: 'ConsentTemplate',
        entityId: id,
        before: { operatorName: current.operatorName, bodyLength: current.bodyMarkdown.length },
        after: { operatorName: updated.operatorName, bodyLength: updated.bodyMarkdown.length },
      });
      return templateDto(updated);
    });
  }

  async publish(id: string): Promise<ConsentTemplateDto> {
    return this.db.tx(async (tx) => {
      const current = await tx.consentTemplate.findUnique({ where: { id } });
      if (!current) throw new DomainError('NOT_FOUND', { resource: 'consent_template' });
      if (current.publishedAt)
        throw new DomainError('INVALID_TRANSITION', { from: 'PUBLISHED', to: 'PUBLISHED', allowed: [] });
      const now = new Date();
      const retired = await tx.consentTemplate.updateMany({
        where: { kind: current.kind, locale: current.locale, publishedAt: { not: null }, retiredAt: null },
        data: { retiredAt: now },
      });
      const published = await tx.consentTemplate.update({ where: { id }, data: { publishedAt: now } });
      await this.audit.record(tx, {
        action: 'consent_template.published',
        entityType: 'ConsentTemplate',
        entityId: id,
        before: { status: 'DRAFT' },
        after: { status: 'PUBLISHED', retiredPrevious: retired.count },
      });
      return templateDto(published);
    });
  }
}
