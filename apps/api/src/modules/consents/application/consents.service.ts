// Согласия (API.md, 4.2; G-01): электронно — только законный представитель из своего аккаунта (или сам
// совершеннолетний спортсмен); тренер и клуб вносят только скан бумажного согласия. Отзыв — событие
// `consent.revoked`: пересчёт допуска (Phase 4) и обезличивание публичного отображения (Phase 9).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  CONSENT_KINDS,
  type ConsentCreate,
  type ConsentDto,
  type ConsentKind,
  type ConsentsStatus,
  fullName,
  isAdultOn,
} from '@sde/contracts';
import { type Prisma, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AthleteAccessService,
  AthleteExtensions,
  electronicConsentDecision,
  type AthleteBasics,
  type RelationInfo,
} from '../../athletes';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { DocumentsService } from '../../documents';
import { OutboxService } from '../../outbox';
import { PeopleService } from '../../people';

const INCLUDE = { template: true, givenBy: true } satisfies Prisma.ConsentInclude;
type Row = Prisma.ConsentGetPayload<{ include: typeof INCLUDE }>;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

@Injectable()
export class ConsentsService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AthleteAccessService,
    private readonly extensions: AthleteExtensions,
    private readonly people: PeopleService,
    private readonly documents: DocumentsService,
    private readonly competitions: CompetitionScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.extensions.registerConsentStatus((personIds) => this.statusOf(personIds));
    // Две записи одного человека: согласия (о ком и кем даны) переходят к оставшейся записи.
    this.people.registerMergeHandler(async (tx, from, to) => {
      await tx.consent.updateMany({ where: { subjectPersonId: from }, data: { subjectPersonId: to } });
      await tx.consent.updateMany({ where: { givenByPersonId: from }, data: { givenByPersonId: to } });
    });
  }

  /** Статус по видам: действующее общее согласие (не для конкретного турнира) любой версии текста. */
  async statusOf(personIds: string[]): Promise<Map<string, ConsentsStatus>> {
    const rows = await this.db.consent.findMany({
      where: { subjectPersonId: { in: personIds }, revokedAt: null, competitionId: null },
      select: { subjectPersonId: true, template: { select: { kind: true } } },
    });
    const given = new Map<string, Set<ConsentKind>>();
    for (const r of rows)
      given.set(r.subjectPersonId, (given.get(r.subjectPersonId) ?? new Set()).add(r.template.kind));
    return new Map(
      personIds.map((id) => [
        id,
        Object.fromEntries(
          CONSENT_KINDS.map((k) => [k, given.get(id)?.has(k) ? 'GIVEN' : 'MISSING']),
        ) as ConsentsStatus,
      ]),
    );
  }

  private toDto(c: Row, subjectPersonId: string): ConsentDto {
    return {
      id: c.id,
      kind: c.template.kind,
      template: {
        id: c.template.id,
        version: c.template.version,
        locale: c.template.locale === 'en' ? 'en' : 'ru',
      },
      method: c.method,
      givenBy: {
        personId: c.givenByPersonId,
        name: fullName(c.givenBy),
        relation: c.givenByPersonId === subjectPersonId ? 'SELF' : 'GUARDIAN',
      },
      documentId: c.documentId,
      competitionId: c.competitionId,
      givenAt: c.givenAt.toISOString(),
      revokedAt: c.revokedAt?.toISOString() ?? null,
      revokeReason: c.revokeReason,
      active: c.revokedAt === null,
    };
  }

  async list(user: AuthUser, athleteId: string): Promise<ConsentDto[]> {
    await this.access.assertView(user, athleteId);
    const athlete = (await this.access.basics({ athleteId })) as AthleteBasics;
    const rows = await this.db.consent.findMany({
      where: { subjectPersonId: athlete.personId },
      include: INCLUDE,
      orderBy: { givenAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r, athlete.personId));
  }

  /** Кто даёт согласие электронно: представитель за несовершеннолетнего, совершеннолетний — сам. */
  private electronicDecision(
    relation: RelationInfo,
    birthDate: string,
  ): 'ALLOWED' | 'GUARDIAN_NOT_VERIFIED' | 'FORBIDDEN' {
    const actor =
      relation.relation === 'SELF'
        ? ({ relation: 'SELF' } as const)
        : relation.relation === 'GUARDIAN'
          ? ({ relation: 'GUARDIAN', verified: relation.verified } as const)
          : null;
    return electronicConsentDecision(actor, birthDate, todayIso());
  }

  private async deny(user: AuthUser, athleteId: string): Promise<never> {
    const visible = await this.access.assertView(user, athleteId).then(
      () => true,
      () => false,
    );
    throw visible ? new DomainError('FORBIDDEN') : new DomainError('NOT_FOUND', { resource: 'athlete' });
  }

  async give(user: AuthUser, athleteId: string, input: ConsentCreate): Promise<ConsentDto> {
    const athlete = await this.access.basics({ athleteId });
    if (!athlete) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    let givenByPersonId: string;
    if (input.method === 'ELECTRONIC') {
      const relation = await this.access.relation(user, athleteId);
      const decision = this.electronicDecision(relation, athlete.birthDate);
      if (decision === 'GUARDIAN_NOT_VERIFIED')
        throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['guardian_not_verified'] });
      if (decision === 'FORBIDDEN' || !user.personId) return this.deny(user, athleteId);
      givenByPersonId = user.personId;
    } else {
      await this.access.assert(user, 'consent.record', athleteId);
      givenByPersonId = await this.paperSigner(
        athleteId,
        athlete.personId,
        athlete.birthDate,
        input.guardianId,
      );
    }
    if (input.competitionId && !(await this.competitions.exists(input.competitionId)))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'competitionId', code: 'not_found' }] });
    const id = await this.persist(user, athleteId, athlete.personId, givenByPersonId, input);
    const row = await this.db.consent.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return this.toDto(row, athlete.personId);
  }

  private persist(
    user: AuthUser,
    athleteId: string,
    subjectPersonId: string,
    givenByPersonId: string,
    input: ConsentCreate,
  ): Promise<string> {
    const athlete = { personId: subjectPersonId };
    return this.db.tx(async (tx) => {
      const template = await tx.consentTemplate.findUnique({ where: { id: input.templateId } });
      if (!template?.publishedAt || template.retiredAt)
        throw new DomainError('VALIDATION_FAILED', {
          fields: [{ path: 'templateId', code: 'template_not_active' }],
        });
      if (input.method === 'PAPER_SCAN')
        await this.documents.assertConsentScan(tx, athleteId, input.documentId as string);
      const active = await tx.consent.findFirst({
        where: {
          subjectPersonId: athlete.personId,
          templateId: template.id,
          competitionId: input.competitionId ?? null,
          revokedAt: null,
        },
      });
      if (active) throw new DomainError('ALREADY_EXISTS', { resource: 'consent' });
      const consent = await tx.consent.create({
        data: {
          id: uuidv7(),
          subjectPersonId: athlete.personId,
          givenByPersonId,
          templateId: template.id,
          competitionId: input.competitionId ?? null,
          method: input.method,
          documentId: input.method === 'PAPER_SCAN' ? (input.documentId ?? null) : null,
          givenAt: new Date(),
          recordedById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'consent.given',
        entityType: 'Consent',
        entityId: consent.id,
        competitionId: consent.competitionId,
        after: {
          athleteId,
          kind: template.kind,
          templateVersion: template.version,
          method: input.method,
          givenBy: givenByPersonId === athlete.personId ? 'SELF' : 'GUARDIAN',
        },
      });
      return consent.id;
    });
  }

  /** Бумажное согласие за несовершеннолетнего подписывает подтверждённый представитель; за взрослого — он сам. */
  private async paperSigner(
    athleteId: string,
    athletePersonId: string,
    birthDate: string,
    guardianId: string | undefined,
  ): Promise<string> {
    if (isAdultOn(birthDate, todayIso())) return athletePersonId;
    if (!guardianId)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'guardianId', code: 'required' }] });
    const guardian = await this.access.guardian(athleteId, guardianId);
    if (!guardian)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'guardianId', code: 'not_found' }] });
    if (!guardian.verified)
      throw new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed: ['guardian_not_verified'] });
    return guardian.personId;
  }

  async revoke(user: AuthUser, consentId: string, reason: string | undefined): Promise<ConsentDto> {
    const consent = await this.db.consent.findUnique({ where: { id: consentId }, include: INCLUDE });
    if (!consent) throw new DomainError('NOT_FOUND', { resource: 'consent' });
    const athlete = await this.access.basics({ personId: consent.subjectPersonId });
    if (!athlete) throw new DomainError('NOT_FOUND', { resource: 'consent' });
    const relation = await this.access.relation(user, athlete.athleteId);
    if (this.electronicDecision(relation, athlete.birthDate) !== 'ALLOWED') {
      const visible = await this.access.assertView(user, athlete.athleteId).then(
        () => true,
        () => false,
      );
      throw visible ? new DomainError('FORBIDDEN') : new DomainError('NOT_FOUND', { resource: 'consent' });
    }
    if (consent.revokedAt)
      throw new DomainError('INVALID_TRANSITION', { from: 'REVOKED', to: 'REVOKED', allowed: [] });
    await this.db.tx(async (tx) => {
      await tx.consent.update({
        where: { id: consentId },
        data: { revokedAt: new Date(), revokedById: user.id, revokeReason: reason ?? null },
      });
      await this.audit.record(tx, {
        action: 'consent.revoked',
        entityType: 'Consent',
        entityId: consentId,
        competitionId: consent.competitionId,
        before: { active: true },
        after: { active: false, kind: consent.template.kind },
        reason: reason ?? null,
      });
      await this.outbox.enqueue(tx, {
        type: 'consent.revoked',
        aggregate: { type: 'Consent', id: consentId },
        competitionId: consent.competitionId,
        payload: { consentId, athleteId: athlete.athleteId, kind: consent.template.kind },
      });
    });
    const row = await this.db.consent.findUniqueOrThrow({ where: { id: consentId }, include: INCLUDE });
    return this.toDto(row, athlete.personId);
  }
}
