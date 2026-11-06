// Заявки организаций на проведение турнира (docs/RATED_ONLY.md, 2). Турнир создаёт только платформа: организация с
// `competition.request` подаёт заявку, администратор платформы (`competition.create_rated`) одобряет её — создаётся
// черновик рейтингового турнира по предложению организации — или отклоняет с причиной. Организация может отозвать
// заявку, пока её не рассмотрели. Каждая команда — одна транзакция с записью аудита.
import { Injectable } from '@nestjs/common';
import {
  type CompetitionCreate,
  CompetitionRequestProposal,
  type HostingResponsible,
  hostingRequirements,
  maskEmail,
  type ResponsibleCandidateDto,
  type ResponsibleCandidatesQuery,
  zonedToInstant,
  type CompetitionRequestAction,
  type CompetitionRequestCreate,
  type CompetitionRequestDraftInput,
  type CompetitionRequestDto,
  type CompetitionRequestsQuery,
  type CompetitionRequestStatus,
  type Page,
  ROLE_PERMISSIONS,
} from '@sde/contracts';
import { Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { OrganizationScopeService } from '../../organizations';
import { toDate } from './competition-edit';
import { CompetitionReferences } from './competition-references';
import { CompetitionsService } from './competitions.service';

const INCLUDE = {
  organization: { select: { id: true, name: true, shortName: true } },
  submittedBy: { select: { id: true, displayName: true } },
  competition: { select: { id: true, slug: true, status: true } },
} satisfies Prisma.CompetitionRequestInclude;

type Row = Prisma.CompetitionRequestGetPayload<{ include: typeof INCLUDE }>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

const DEFAULT_TIMEZONE = 'Europe/Moscow';
const DEFAULT_DISCIPLINE = 'SPORT_SAMBO';
const DRAFT_NAME = 'Черновик турнира';

interface References {
  venues: Map<string, CompetitionRequestDto['venue']>;
  ageGroups: Map<string, CompetitionRequestDto['ageGroups'][number]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Черновик турнира по заявке. У новых заявок нет окна регистрации — его уточняет платформа после одобрения; до этого
 * в черновике окно от «сейчас» до начала дня турнира (проверка сроков — при публикации). Адрес и ответственный
 * переносятся в описание и контакты турнира.
 */
export function draftFromProposal(
  p: CompetitionRequestProposal,
  organizerOrganizationId: string,
  now: Date,
): Omit<CompetitionCreate, 'competitionType'> {
  const endsAt = p.registrationEndsAt ?? zonedToInstant(`${p.startDate}T00:00`, p.timezone);
  const startsAt =
    p.registrationStartsAt ?? new Date(Math.min(now.getTime(), Date.parse(endsAt) - DAY_MS)).toISOString();
  const r = p.responsible;
  const contact =
    p.contactInfo ??
    (r
      ? {
          name: r.kind === 'CONTACT' ? r.fullName : r.displayName,
          ...(r.email ? { email: r.email } : {}),
          ...(r.phone ? { phone: r.phone } : {}),
        }
      : undefined);
  const description =
    p.descriptionMd ?? (p.address ? `**Место проведения:** ${p.address.replace(/[*_`#]/g, '')}` : undefined);
  return {
    name: p.name,
    shortName: p.shortName,
    venueId: p.venueId,
    timezone: p.timezone,
    startDate: p.startDate,
    endDate: p.endDate,
    registrationStartsAt: startsAt,
    registrationEndsAt: endsAt,
    level: p.level,
    disciplineCode: p.disciplineCode,
    descriptionMd: description,
    contactInfo: contact,
    refereeRecruitment: p.refereeRecruitment,
    organizerOrganizationId,
  };
}

@Injectable()
export class CompetitionRequestsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly refs: CompetitionReferences,
    private readonly competitions: CompetitionsService,
    private readonly audit: AuditService,
  ) {}

  private isPlatform(user: AuthUser): Promise<boolean> {
    return this.policy.can(user, 'competition.create_rated', { kind: 'PLATFORM' });
  }

  // ---------- Чтение ----------

  /** Платформа видит все заявки, организация — свои (где у пользователя есть `competition.request`). */
  async list(user: AuthUser, q: CompetitionRequestsQuery): Promise<Page<CompetitionRequestDto>> {
    const and: Prisma.CompetitionRequestWhereInput[] = [];
    const platform = await this.isPlatform(user);
    // Черновики видит только организация-автор (правки 05.11.2026).
    if (platform) and.push({ status: { not: 'DRAFT' } });
    if (!platform) {
      const grants = await this.policy.grants(user);
      const own = grants.organizations
        .filter((g) => g.roles.some((r) => ROLE_PERMISSIONS[r]['competition.request'] !== undefined))
        .map((g) => g.organizationId);
      and.push({ organizationId: { in: own } });
    }
    if (q.status) and.push({ status: q.status });
    if (q.organizationId) and.push({ organizationId: q.organizationId });
    const cursor = decodeCursor(q.cursor);
    if (cursor) and.push({ id: { lt: cursor.id } });
    const rows = await this.db.competitionRequest.findMany({
      where: { AND: and },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      include: INCLUDE,
    });
    const refs = await this.references(rows);
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: r.id, id: r.id }),
      (r) => this.toDto(r, refs, this.actions(r, platform, !platform)),
    );
  }

  async get(user: AuthUser, id: string): Promise<CompetitionRequestDto> {
    const row = await this.db.competitionRequest.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    const platform = await this.isPlatform(user);
    const own =
      !platform &&
      (await this.policy.can(user, 'competition.request', await this.orgScopes.scopeOf(row.organizationId)));
    if (!platform && !own) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    if (platform && row.status === 'DRAFT')
      throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    return this.toDto(row, await this.references([row]), this.actions(row, platform, own));
  }

  /**
   * Поиск ответственного для формы заявки: активные пользователи, у которых имя в профиле, ФИО или почта содержат
   * каждое слово запроса. Доступен тем, кто может подавать заявки; не больше 10 результатов, почта скрыта наполовину.
   */
  async responsibleCandidates(
    user: AuthUser,
    q: ResponsibleCandidatesQuery,
  ): Promise<ResponsibleCandidateDto[]> {
    const grants = await this.policy.grants(user);
    const canRequest = grants.organizations.some((g) =>
      g.roles.some((r) => ROLE_PERMISSIONS[r]['competition.request'] !== undefined),
    );
    if (!canRequest && !(await this.isPlatform(user))) throw new DomainError('FORBIDDEN');
    const words = q.q.split(/\s+/).filter(Boolean).slice(0, 4);
    const rows = await this.db.user.findMany({
      where: {
        deletedAt: null,
        isDemo: false,
        status: 'ACTIVE',
        AND: words.map((w) => ({
          OR: [
            { displayName: { contains: w, mode: 'insensitive' as const } },
            { email: { contains: w } },
            { person: { lastName: { contains: w, mode: 'insensitive' as const } } },
            { person: { firstName: { contains: w, mode: 'insensitive' as const } } },
            { person: { middleName: { contains: w, mode: 'insensitive' as const } } },
          ],
        })),
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: 10,
      select: { id: true, displayName: true, email: true },
    });
    return rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      maskedEmail: r.email ? maskEmail(r.email) : null,
    }));
  }

  // ---------- Команды ----------

  async submit(user: AuthUser, input: CompetitionRequestCreate): Promise<CompetitionRequestDto> {
    const scope = await this.orgScopes.scopeOf(input.organizationId);
    await this.policy.assert(user, 'competition.request', scope);
    if (!scope.visibleToAll)
      throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: input.organizationId });
    const { organizationId, comment } = input;
    const id = await this.db.tx(async (tx) => {
      await this.assertTemplateAgeGroups(tx, input.ageGroupIds);
      const responsible = await this.responsible(tx, user, input.responsible);
      const proposal: CompetitionRequestProposal = CompetitionRequestProposal.parse({
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate ?? input.startDate,
        // Часовой пояс, уровень и дисциплину, сроки регистрации и взвешивания уточняет платформа после одобрения.
        timezone: DEFAULT_TIMEZONE,
        level: 'CLUB',
        disciplineCode: DEFAULT_DISCIPLINE,
        address: input.address,
        ageGroupIds: input.ageGroupIds,
        matCount: input.matCount,
        equipment: input.equipment,
        refereeTeam: input.refereeTeam,
        gender: input.gender,
        responsible,
        rulesAcceptedAt: new Date().toISOString(),
      });
      const fields = {
        organizationId,
        submittedById: user.id,
        name: proposal.name,
        startDate: toDate(proposal.startDate),
        endDate: toDate(proposal.endDate),
        proposal,
        expectedParticipants: null,
        comment: comment || null,
      };
      // Подача черновика: та же запись становится поданной заявкой, данные формы черновика больше не нужны.
      const created = input.draftId
        ? await this.submitDraft(tx, input.draftId, fields)
        : await tx.competitionRequest.create({ data: { id: uuidv7(), ...fields } });
      await this.audit.record(tx, {
        action: 'competition_request.submitted',
        entityType: 'CompetitionRequest',
        entityId: created.id,
        organizationId,
        after: {
          name: proposal.name,
          startDate: proposal.startDate,
          matCount: input.matCount,
          ageGroupIds: input.ageGroupIds,
          rulesAccepted: true,
        },
      });
      return created.id;
    });
    return this.get(user, id);
  }

  /** Черновик под блокировкой: той же организации и ещё не поданный. */
  private async submitDraft(
    tx: Tx,
    draftId: string,
    fields: Omit<Prisma.CompetitionRequestUncheckedCreateInput, 'id'>,
  ): Promise<{ id: string }> {
    const [row] = await tx.$queryRaw<{ organization_id: string; status: CompetitionRequestStatus }[]>`
      SELECT organization_id, status FROM competition_request WHERE id = ${draftId}::uuid FOR UPDATE`;
    if (!row || row.organization_id !== fields.organizationId)
      throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    if (row.status !== 'DRAFT')
      throw new DomainError('COMPETITION_REQUEST_NOT_PENDING', { status: row.status });
    return tx.competitionRequest.update({
      where: { id: draftId },
      data: { ...fields, status: 'SUBMITTED', draft: Prisma.DbNull, version: { increment: 1 } },
      select: { id: true },
    });
  }

  /**
   * Черновик заявки (правки 05.11.2026): данные формы сохраняются как есть, проверка — при подаче. Новый черновик
   * или правка своего (`id`). В списке и карточке черновик виден только организации.
   */
  async saveDraft(
    user: AuthUser,
    input: CompetitionRequestDraftInput,
    id?: string,
  ): Promise<CompetitionRequestDto> {
    await this.policy.assert(user, 'competition.request', await this.orgScopes.scopeOf(input.organizationId));
    const today = new Date().toISOString().slice(0, 10);
    const dateOf = (v: unknown): string =>
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : today;
    const startDate = dateOf(input.data.startDate);
    const endRaw = dateOf(input.data.endDate ?? startDate);
    const endDate = endRaw < startDate ? startDate : endRaw;
    const name = input.name && input.name.length >= 3 ? input.name : DRAFT_NAME;
    const proposal = CompetitionRequestProposal.parse({
      name,
      startDate,
      endDate,
      timezone: DEFAULT_TIMEZONE,
      level: 'CLUB',
      disciplineCode: DEFAULT_DISCIPLINE,
    });
    const fields = {
      organizationId: input.organizationId,
      submittedById: user.id,
      name,
      startDate: toDate(startDate),
      endDate: toDate(endDate),
      proposal,
      draft: input.data as Prisma.InputJsonValue,
    };
    const savedId = await this.db.tx(async (tx) => {
      if (!id) {
        const created = await tx.competitionRequest.create({
          data: { id: uuidv7(), status: 'DRAFT', ...fields },
        });
        return created.id;
      }
      const [row] = await tx.$queryRaw<{ organization_id: string; status: CompetitionRequestStatus }[]>`
        SELECT organization_id, status FROM competition_request WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
      await this.policy.assert(
        user,
        'competition.request',
        await this.orgScopes.scopeOf(row.organization_id),
      );
      if (row.status !== 'DRAFT')
        throw new DomainError('COMPETITION_REQUEST_NOT_PENDING', { status: row.status });
      await tx.competitionRequest.update({ where: { id }, data: { ...fields, version: { increment: 1 } } });
      return id;
    });
    return this.get(user, savedId);
  }

  /** Удаление черновика: запись остаётся отозванной (удаление строк заявок запрещено ролью приложения). */
  async discardDraft(user: AuthUser, id: string): Promise<void> {
    const current = await this.require(id);
    await this.policy.assert(
      user,
      'competition.request',
      await this.orgScopes.scopeOf(current.organizationId),
    );
    await this.db.tx(async (tx) => {
      const { count } = await tx.competitionRequest.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'WITHDRAWN', draft: Prisma.DbNull, version: { increment: 1 } },
      });
      if (count === 0) throw new DomainError('COMPETITION_REQUEST_NOT_PENDING', {});
    });
  }

  /**
   * Публикация турнира по одобренной заявке (правки 05.11.2026, «На согласовании» → «Опубликован»): когда условия
   * согласованы и турнир подготовлен, организатор публикует его сам; дальше турниром управляет платформа. Условия
   * публикации (категории, правила, сроки) — те же, что у перехода турнира DRAFT → PUBLISHED.
   */
  async publish(user: AuthUser, id: string): Promise<CompetitionRequestDto> {
    const row = await this.db.competitionRequest.findUnique({
      where: { id },
      select: {
        organizationId: true,
        status: true,
        competition: { select: { id: true, status: true, version: true } },
      },
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    const platform = await this.isPlatform(user);
    if (!platform)
      await this.policy.assert(user, 'competition.request', await this.orgScopes.scopeOf(row.organizationId));
    if (row.status !== 'APPROVED' || !row.competition || row.competition.status !== 'DRAFT')
      throw new DomainError('COMPETITION_STAGE_MISMATCH', { status: row.competition?.status ?? row.status });
    await this.competitions.transition(
      user,
      row.competition.id,
      row.competition.version,
      { to: 'PUBLISHED' },
      true,
    );
    return this.get(user, id);
  }

  async withdraw(user: AuthUser, id: string, version: number): Promise<CompetitionRequestDto> {
    const current = await this.require(id);
    await this.policy.assert(
      user,
      'competition.request',
      await this.orgScopes.scopeOf(current.organizationId),
    );
    await this.db.tx(async (tx) => {
      await this.lockPending(tx, id, version);
      await this.decide(tx, id, 'WITHDRAWN', user.id, null);
      await this.audit.record(tx, {
        action: 'competition_request.withdrawn',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: current.organizationId,
        before: { status: 'SUBMITTED' },
        after: { status: 'WITHDRAWN' },
      });
    });
    return this.get(user, id);
  }

  async reject(user: AuthUser, id: string, version: number, reason: string): Promise<CompetitionRequestDto> {
    await this.policy.assert(user, 'competition.create_rated', { kind: 'PLATFORM' });
    await this.db.tx(async (tx) => {
      const row = await this.lockPending(tx, id, version);
      await this.decide(tx, id, 'REJECTED', user.id, reason);
      await this.audit.record(tx, {
        action: 'competition_request.rejected',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: row.organizationId,
        before: { status: 'SUBMITTED' },
        after: { status: 'REJECTED' },
        reason,
        platformIntervention: true,
      });
    });
    return this.get(user, id);
  }

  /**
   * Одобрение (описание процесса, 02.11.2026, п. 5–6): черновик рейтингового турнира по заявке, организатор —
   * организация заявки; дальше турниром управляет администратор платформы — он связывается с ответственным и уточняет
   * сроки регистрации, взвешивания, категории и правила. Отдельная роль руководителя турнира автору не выдаётся.
   */
  async approve(user: AuthUser, id: string, version: number): Promise<CompetitionRequestDto> {
    await this.policy.assert(user, 'competition.create_rated', { kind: 'PLATFORM' });
    await this.db.tx(async (tx) => {
      const row = await this.lockPending(tx, id, version);
      const scope = await this.orgScopes.scopeOf(row.organizationId);
      if (!scope.visibleToAll)
        throw new DomainError('ORGANIZATION_NOT_ACTIVE', { organizationId: row.organizationId });
      const proposal = CompetitionRequestProposal.parse(row.proposal);
      const competitionId = await this.competitions.insert(
        tx,
        user,
        draftFromProposal(proposal, row.organizationId, new Date()),
        { requestId: id },
      );
      await this.decide(tx, id, 'APPROVED', user.id, null, competitionId);
      await this.audit.record(tx, {
        action: 'competition_request.approved',
        entityType: 'CompetitionRequest',
        entityId: id,
        organizationId: row.organizationId,
        competitionId,
        before: { status: 'SUBMITTED' },
        after: { status: 'APPROVED', competitionId },
        platformIntervention: true,
      });
    });
    return this.get(user, id);
  }

  // ---------- Внутреннее ----------

  /**
   * Возрастные группы заявки — только шаблоны платформы (без организации-владельца). Без групп заявку можно подать,
   * только пока у платформы нет ни одного шаблона.
   */
  private async assertTemplateAgeGroups(tx: Tx, ids: string[]): Promise<void> {
    const where = { deletedAt: null, ownerOrganizationId: null, disciplineCode: DEFAULT_DISCIPLINE };
    if (ids.length === 0) {
      if ((await tx.ageGroup.count({ where })) > 0)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'ageGroupIds', code: 'required' }] });
      return;
    }
    const found = await tx.ageGroup.count({ where: { ...where, id: { in: ids } } });
    if (found !== ids.length)
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'ageGroupIds', code: 'not_found' }] });
  }

  /** Ответственный за проведение: сам автор, найденный зарегистрированный пользователь или контактные данные. */
  private async responsible(
    tx: Tx,
    user: AuthUser,
    input: CompetitionRequestCreate['responsible'],
  ): Promise<HostingResponsible> {
    if (input.kind === 'CONTACT') return input;
    const found = await tx.user.findFirst({
      where:
        input.kind === 'SELF'
          ? { id: user.id }
          : { id: input.userId, deletedAt: null, isDemo: false, status: 'ACTIVE' },
      select: { id: true, displayName: true, email: true },
    });
    if (!found)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'responsible.userId', code: 'user_not_found' }],
      });
    return {
      kind: input.kind,
      userId: found.id,
      displayName: found.displayName,
      ...(found.email ? { email: found.email } : {}),
    };
  }

  private async require(id: string): Promise<{ organizationId: string }> {
    const row = await this.db.competitionRequest.findUnique({
      where: { id },
      select: { organizationId: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    return row;
  }

  /** Заявка на рассмотрении с ожидаемой версией, под блокировкой строки. */
  private async lockPending(
    tx: Tx,
    id: string,
    version: number,
  ): Promise<{ organizationId: string; proposal: unknown }> {
    const [row] = await tx.$queryRaw<
      { organization_id: string; status: CompetitionRequestStatus; version: number; proposal: unknown }[]
    >`SELECT organization_id, status, version, proposal FROM competition_request WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    if (row.version !== version) throw versionConflict(row.version);
    if (row.status !== 'SUBMITTED')
      throw new DomainError('COMPETITION_REQUEST_NOT_PENDING', { status: row.status });
    return { organizationId: row.organization_id, proposal: row.proposal };
  }

  private async decide(
    tx: Tx,
    id: string,
    status: CompetitionRequestStatus,
    userId: string,
    reason: string | null,
    competitionId: string | null = null,
  ): Promise<void> {
    await tx.competitionRequest.update({
      where: { id },
      data: {
        status,
        decisionReason: reason,
        decidedById: userId,
        decidedAt: new Date(),
        competitionId,
        version: { increment: 1 },
      },
    });
  }

  private actions(row: Row, platform: boolean, own: boolean): CompetitionRequestAction[] {
    if (row.status === 'DRAFT') return own ? ['edit', 'discard'] : [];
    if (row.status === 'APPROVED')
      return (own || platform) && row.competition?.status === 'DRAFT' ? ['publish'] : [];
    if (row.status !== 'SUBMITTED') return [];
    const actions: CompetitionRequestAction[] = [];
    if (platform) actions.push('approve', 'reject');
    if (own) actions.push('withdraw');
    return actions;
  }

  /** Площадки старых заявок и возрастные группы новых — одним запросом на страницу. */
  private async references(rows: Row[]): Promise<References> {
    const proposals = rows
      .map((r) => CompetitionRequestProposal.safeParse(r.proposal))
      .flatMap((p) => (p.success ? [p.data] : []));
    const venueIds = [...new Set(proposals.flatMap((p) => (p.venueId ? [p.venueId] : [])))];
    const groupIds = [...new Set(proposals.flatMap((p) => p.ageGroupIds ?? []))];
    const [venues, groups] = await Promise.all([
      venueIds.length
        ? this.db.venue.findMany({
            where: { id: { in: venueIds } },
            select: { id: true, name: true, address: true, city: true },
          })
        : [],
      groupIds.length
        ? this.db.ageGroup.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, nameRu: true, nameEn: true, ageFrom: true, ageTo: true },
          })
        : [],
    ]);
    return {
      venues: new Map(venues.map((v) => [v.id, v])),
      ageGroups: new Map(
        groups.map((g) => [
          g.id,
          { id: g.id, name: { ru: g.nameRu, en: g.nameEn }, ageFrom: g.ageFrom, ageTo: g.ageTo },
        ]),
      ),
    };
  }

  private toDto(
    row: Row,
    refs: References,
    allowedActions: CompetitionRequestAction[],
  ): CompetitionRequestDto {
    const proposal = CompetitionRequestProposal.parse(row.proposal);
    const ageGroupIds = proposal.ageGroupIds ?? [];
    return {
      id: row.id,
      status: row.status,
      organization: row.organization,
      submittedBy: row.submittedBy,
      name: row.name,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
      level: proposal.level,
      venue: proposal.venueId ? (refs.venues.get(proposal.venueId) ?? null) : null,
      ageGroups: ageGroupIds.flatMap((g) => {
        const group = refs.ageGroups.get(g);
        return group ? [group] : [];
      }),
      requirements:
        proposal.matCount !== undefined ? hostingRequirements(proposal.matCount, ageGroupIds.length) : null,
      proposal,
      expectedParticipants: row.expectedParticipants,
      comment: row.comment,
      decisionReason: row.decisionReason,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      competitionId: row.competitionId,
      competition: row.competition,
      draft: row.status === 'DRAFT' ? ((row.draft ?? {}) as Record<string, unknown>) : null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions,
    };
  }
}
