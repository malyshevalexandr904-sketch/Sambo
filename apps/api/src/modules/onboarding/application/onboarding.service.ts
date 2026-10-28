// Заявка на регистрацию — сторона заявителя (Phase 9a; API.md, 3.10): черновик, изменение без потери введённого,
// документы, отправка с согласием на обработку ПДн, отмена, статус и история. Профили и связи появляются только после
// одобрения (OnboardingReviewService). Все проверки — на сервере; клиент не может сменить роль, статус и заявителя.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  allowedDocumentTypes,
  isOpenOnboardingStatus,
  type OnboardingAction,
  type OnboardingCreate,
  type OnboardingDocumentAttach,
  type OnboardingHistoryDto,
  type OnboardingOverviewDto,
  type OnboardingPatch,
  type OnboardingRequestDto,
} from '@sde/contracts';
import { Prisma, type Tx, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AthleteRegistryService } from '../../athletes';
import { AuditService } from '../../audit';
import { CoachesService } from '../../coaches';
import { FilesService } from '../../files';
import { OrganizationRegistryService } from '../../organizations';
import { PeopleService } from '../../people';
import { RefereesService } from '../../referees';
import { SettingsService } from '../../settings';
import { isEditable } from '../domain/onboarding-rules';
import { OnboardingAccessService } from './onboarding-access.service';
import {
  ONBOARDING_INCLUDE,
  type OnboardingRow,
  scenarioOf,
  toHistoryDto,
  toOnboardingDto,
} from './onboarding-mapper';
import { applyPatch, dataOf, emptyState, type OnboardingState, sanitize, stateOf } from './onboarding-state';

/** Документов в одной заявке — не больше. */
const MAX_DOCUMENTS = 20;

const invalid = (path: string, code: string): DomainError =>
  new DomainError('VALIDATION_FAILED', { fields: [{ path, code }] });

@Injectable()
export class OnboardingService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly access: OnboardingAccessService,
    private readonly organizations: OrganizationRegistryService,
    private readonly coaches: CoachesService,
    private readonly athletes: AthleteRegistryService,
    private readonly referees: RefereesService,
    private readonly people: PeopleService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // Документ заявки загружает любой вошедший с подтверждённым email; привязка к заявке — отдельной командой.
    // Документы анкеты загружаются до подтверждения email (правки 28.10.2026): адрес проверяется при отправке заявки.
    this.files.registerUploadPolicy('ONBOARDING_DOCUMENT', () => Promise.resolve(true));
    // Скачивание по fileId: только заявитель и проверяющий заявки (не автор файла сам по себе после привязки).
    this.files.registerAccessPolicy('ONBOARDING_DOCUMENT', async (user, file) => {
      const doc = await this.db.onboardingDocument.findUnique({
        where: { fileId: file.id },
        include: { request: true },
      });
      if (!doc) return file.uploadedById === user.id;
      if (doc.deletedAt) return false;
      return doc.request.userId === user.id || (await this.access.canViewAsReviewer(user, doc.request));
    });
  }

  rules() {
    return this.settings.get('onboarding.documentRules');
  }

  // ---------- Чтение ----------

  private async load(id: string): Promise<OnboardingRow> {
    const row = await this.db.onboardingRequest.findUnique({ where: { id }, include: ONBOARDING_INCLUDE });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'onboarding_request' });
    return row;
  }

  /** Заявка, видимая пользователю: своя или как проверяющему; иначе — 404 (не раскрываем существование). */
  async loadVisible(user: AuthUser, id: string): Promise<{ row: OnboardingRow; asReviewer: boolean }> {
    const row = await this.load(id);
    if (row.userId === user.id) return { row, asReviewer: false };
    if (await this.access.canViewAsReviewer(user, row)) return { row, asReviewer: true };
    throw new DomainError('NOT_FOUND', { resource: 'onboarding_request' });
  }

  async toDto(user: AuthUser, row: OnboardingRow, asReviewer: boolean): Promise<OnboardingRequestDto> {
    const actions: OnboardingAction[] = [];
    if (row.userId === user.id) {
      if (isEditable(row.status)) actions.push('update', 'submit');
      if (isOpenOnboardingStatus(row.status)) actions.push('cancel');
    } else if (await this.access.reviewerRole(user, row)) {
      actions.push('approve', 'reject', 'request_changes');
    }
    let reviewer: { possibleDuplicates: number } | null = null;
    if (asReviewer) {
      const applicant = await this.db.user.findUnique({
        where: { id: row.userId },
        select: { personId: true },
      });
      const duplicates =
        row.lastName && row.firstName && row.birthDate
          ? await this.people.exactMatches(
              this.db,
              {
                lastName: row.lastName,
                firstName: row.firstName,
                middleName: row.middleName,
                birthDate: row.birthDate.toISOString().slice(0, 10),
              },
              { excludePersonId: applicant?.personId ?? null },
            )
          : [];
      reviewer = { possibleDuplicates: duplicates.length };
    }
    return toOnboardingDto(row, { rules: await this.rules(), actions, reviewer });
  }

  async get(user: AuthUser, id: string): Promise<OnboardingRequestDto> {
    const { row, asReviewer } = await this.loadVisible(user, id);
    return this.toDto(user, row, asReviewer);
  }

  async history(user: AuthUser, id: string): Promise<OnboardingHistoryDto[]> {
    await this.loadVisible(user, id);
    const rows = await this.db.onboardingStatusChange.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, displayName: true } } },
    });
    return rows.map(toHistoryDto);
  }

  /** Кабинет: все заявки пользователя (новые сверху) и подтверждённые профили. */
  async overview(user: AuthUser): Promise<OnboardingOverviewDto> {
    const rows = await this.db.onboardingRequest.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: ONBOARDING_INCLUDE,
      take: 50,
    });
    const requests = await Promise.all(rows.map((r) => this.toDto(user, r, false)));
    const personId = (await this.db.user.findUnique({ where: { id: user.id }, select: { personId: true } }))
      ?.personId;
    const profiles = personId
      ? await this.db.tx(async (tx) => ({
          athleteId: await this.athletes.profileOf(tx, personId),
          coachId:
            (await tx.coachProfile.findUnique({ where: { personId }, select: { id: true } }))?.id ?? null,
          refereeId: await this.referees.profileOf(tx, personId),
        }))
      : { athleteId: null, coachId: null, refereeId: null };
    return {
      requests,
      profiles: { ...profiles, managedOrganizationIds: await this.organizations.managedBy(user.id) },
    };
  }

  // ---------- Черновик ----------

  /** Ссылки заявки существуют и допустимы: организация активна, тренер работает в ней, категория и регион есть. */
  private async assertReferences(tx: Tx, s: OnboardingState): Promise<void> {
    if (s.organizationId && !(await this.organizations.isSelectable(tx, s.organizationId)))
      throw invalid('organizationId', 'not_found');
    if (
      s.coachId &&
      (!s.organizationId || !(await this.coaches.isSelectableIn(tx, s.coachId, s.organizationId)))
    )
      throw invalid('coachId', 'not_found');
    if (
      s.refereeCategoryCode &&
      !(await tx.refereeCategory.findUnique({ where: { code: s.refereeCategoryCode } }))
    )
      throw invalid('refereeCategoryCode', 'invalid_code');
    const o = s.organization;
    if (o?.countryCode && !(await tx.country.findUnique({ where: { code: o.countryCode } })))
      throw invalid('organization.countryCode', 'invalid_country');
    if (o?.regionId) {
      const region = await tx.region.findUnique({ where: { id: o.regionId } });
      if (!region || (o.countryCode && region.countryCode !== o.countryCode))
        throw invalid('organization.regionId', 'invalid_region');
    }
  }

  /**
   * Присоединение к организации — для тренера или спортсмена, уже зарегистрированного (профиль одобрен); первичная
   * регистрация роли, профиль которой уже есть, не нужна — для неё есть присоединение.
   */
  private async assertKindAllowed(tx: Tx, user: AuthUser, input: OnboardingCreate): Promise<void> {
    const personId = (await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { personId: true } }))
      .personId;
    const profile =
      !personId || (input.role !== 'COACH' && input.role !== 'ATHLETE' && input.role !== 'REFEREE')
        ? null
        : input.role === 'COACH'
          ? await tx.coachProfile.findUnique({ where: { personId }, select: { id: true } })
          : input.role === 'ATHLETE'
            ? await tx.athleteProfile.findUnique({ where: { personId }, select: { id: true } })
            : await tx.refereeProfile.findUnique({ where: { personId }, select: { id: true } });
    if (input.kind === 'JOIN_ORGANIZATION') {
      if (input.role !== 'COACH' && input.role !== 'ATHLETE') throw invalid('kind', 'not_allowed');
      if (!profile) throw invalid('kind', 'profile_required');
      return;
    }
    if (profile) throw new DomainError('ALREADY_EXISTS', { resource: 'profile', role: input.role });
  }

  async create(user: AuthUser, input: OnboardingCreate): Promise<OnboardingRequestDto> {
    const id = uuidv7();
    try {
      await this.db.tx(async (tx) => {
        await this.assertKindAllowed(tx, user, input);
        const open = await tx.onboardingRequest.findFirst({
          where: {
            userId: user.id,
            role: input.role,
            status: { in: ['DRAFT', 'PENDING_REVIEW', 'PENDING_ORGANIZATION_APPROVAL', 'CHANGES_REQUESTED'] },
          },
          select: { id: true },
        });
        if (open) throw new DomainError('ALREADY_EXISTS', { resource: 'onboarding_request', id: open.id });
        const { role, kind, ...patch } = input;
        const state = sanitize(role, kind, applyPatch(emptyState(), patch));
        if (!state.contactEmail && user.email) state.contactEmail = user.email;
        await this.assertReferences(tx, state);
        await tx.onboardingRequest.create({ data: { id, userId: user.id, role, kind, ...dataOf(state) } });
        await tx.onboardingStatusChange.create({
          data: { id: uuidv7(), requestId: id, fromStatus: null, toStatus: 'DRAFT', actorUserId: user.id },
        });
        await this.audit.record(tx, {
          action: 'onboarding.created',
          entityType: 'OnboardingRequest',
          entityId: id,
          after: { role, kind, status: 'DRAFT' },
        });
      });
    } catch (e) {
      // Гонка двух черновиков одной роли: уникальный индекс незавершённой заявки.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new DomainError('ALREADY_EXISTS', { resource: 'onboarding_request' });
      throw e;
    }
    return this.get(user, id);
  }

  private async ownEditable(tx: Tx, user: AuthUser, id: string) {
    const row = await tx.onboardingRequest.findUnique({ where: { id } });
    if (!row || row.userId !== user.id)
      throw new DomainError('NOT_FOUND', { resource: 'onboarding_request' });
    if (!isEditable(row.status))
      throw new DomainError('INVALID_TRANSITION', { from: row.status, to: row.status, allowed: [] });
    return row;
  }

  /** Изменение черновика или заявки, возвращённой на исправление: введённое ранее сохраняется. */
  async update(
    user: AuthUser,
    id: string,
    version: number,
    patch: OnboardingPatch,
  ): Promise<OnboardingRequestDto> {
    await this.db.tx(async (tx) => {
      const row = await this.ownEditable(tx, user, id);
      const state = sanitize(row.role, row.kind, applyPatch(stateOf(row), patch));
      await this.assertReferences(tx, state);
      const { count } = await tx.onboardingRequest.updateMany({
        where: { id, version },
        data: { ...dataOf(state), version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict(row.version);
      await this.audit.record(tx, {
        action: 'onboarding.updated',
        entityType: 'OnboardingRequest',
        entityId: id,
        after: { fields: Object.keys(patch).sort() },
      });
    });
    return this.get(user, id);
  }

  // ---------- Документы ----------

  async attachDocument(
    user: AuthUser,
    id: string,
    input: OnboardingDocumentAttach,
  ): Promise<OnboardingRequestDto> {
    const rules = await this.rules();
    await this.db.tx(async (tx) => {
      const row = await this.ownEditable(tx, user, id);
      const full = await tx.onboardingRequest.findUniqueOrThrow({
        where: { id },
        include: ONBOARDING_INCLUDE,
      });
      if (!allowedDocumentTypes(rules, scenarioOf(full)).includes(input.typeCode))
        throw invalid('typeCode', 'not_allowed');
      if (full.documents.length >= MAX_DOCUMENTS) throw invalid('fileId', 'too_many_documents');
      const type = await tx.documentType.findUnique({ where: { code: input.typeCode } });
      if (!type) throw invalid('typeCode', 'invalid_code');
      const file = await this.files.attachableFile(tx, input.fileId, user.id);
      if (!file || file.purpose !== 'ONBOARDING_DOCUMENT') throw invalid('fileId', 'invalid_file');
      if (!type.allowedMime.split(',').includes(file.mimeType))
        throw new DomainError('UNSUPPORTED_FILE_TYPE', { allowed: type.allowedMime.split(',') });
      if (Number(file.sizeBytes) > type.maxSizeBytes)
        throw new DomainError('FILE_TOO_LARGE', { maxSizeBytes: type.maxSizeBytes });
      if (await tx.onboardingDocument.findUnique({ where: { fileId: file.id } }))
        throw new DomainError('ALREADY_EXISTS', { resource: 'onboarding_document' });
      const docId = uuidv7();
      await tx.onboardingDocument.create({
        data: { id: docId, requestId: row.id, typeCode: type.code, fileId: file.id, uploadedById: user.id },
      });
      await tx.onboardingRequest.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'onboarding.document_attached',
        entityType: 'OnboardingRequest',
        entityId: id,
        after: { documentId: docId, typeCode: type.code },
      });
    });
    return this.get(user, id);
  }

  async removeDocument(user: AuthUser, id: string, documentId: string): Promise<OnboardingRequestDto> {
    await this.db.tx(async (tx) => {
      await this.ownEditable(tx, user, id);
      const doc = await tx.onboardingDocument.findFirst({
        where: { id: documentId, requestId: id, deletedAt: null },
      });
      if (!doc) throw new DomainError('NOT_FOUND', { resource: 'onboarding_document' });
      await tx.onboardingDocument.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      await tx.onboardingRequest.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'onboarding.document_removed',
        entityType: 'OnboardingRequest',
        entityId: id,
        before: { documentId: doc.id, typeCode: doc.typeCode },
      });
    });
    return this.get(user, id);
  }

  /** Временная ссылка на документ — заявителю и проверяющему; скачивание пишется в журнал доступа. */
  async documentUrl(
    user: AuthUser,
    id: string,
    documentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    await this.loadVisible(user, id);
    const doc = await this.db.onboardingDocument.findFirst({
      where: { id: documentId, requestId: id, deletedAt: null },
    });
    if (!doc) throw new DomainError('NOT_FOUND', { resource: 'onboarding_document' });
    return this.files.grantedDownloadUrl(doc.fileId, {
      resourceType: 'OnboardingDocument',
      resourceId: doc.id,
    });
  }
}
