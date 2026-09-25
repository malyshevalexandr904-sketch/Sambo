// Документы (API.md, 4.6): загрузка в приватное хранилище, проверка в контексте турнира, журнал доступа.
// Статусы — ARCHITECTURE.md, 16.4; EXPIRED выставляет worker по сроку действия.
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type DocumentCreate,
  type DocumentDto,
  type DocumentsQuery,
  type DocumentTransitionRequest,
  type DownloadUrl,
  fullName,
  type Page,
} from '@sde/contracts';
import { type Prisma, type Tx, uuidv7 } from '@sde/db';
import type { Env } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError, versionConflict } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService, AthleteExtensions } from '../../athletes';
import { AuditService, DataAccessLogService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { FilesService } from '../../files';
import { OrganizationScopeService } from '../../organizations';
import { EmailRequestService, OutboxService } from '../../outbox';
import { canDelete, checkReview, isExpired, mimeAllowed } from '../domain/document-rules';
import { DocumentAccessService } from './document-access.service';

const INCLUDE = {
  file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
  athlete: {
    select: { id: true, person: { select: { lastName: true, firstName: true, middleName: true } } },
  },
  organization: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.DocumentInclude;

type Row = Prisma.DocumentGetPayload<{ include: typeof INCLUDE }>;

const today = (): string => new Date().toISOString().slice(0, 10);
const toDate = (d: string): Date => new Date(`${d}T00:00:00.000Z`);

function toDto(d: Row, allowedActions: string[]): DocumentDto {
  const owner: DocumentDto['owner'] = d.athlete
    ? { type: 'ATHLETE', athleteId: d.athlete.id, name: fullName(d.athlete.person) }
    : d.organization
      ? { type: 'ORGANIZATION', organizationId: d.organization.id, name: d.organization.name }
      : { type: 'APPLICATION', applicationId: d.applicationId ?? '' };
  return {
    id: d.id,
    typeCode: d.typeCode,
    owner,
    competitionId: d.competitionId,
    status: d.status,
    expirationDate: d.expirationDate ? d.expirationDate.toISOString().slice(0, 10) : null,
    file: { ...d.file, sizeBytes: Number(d.file.sizeBytes) },
    uploadedAt: d.uploadedAt.toISOString(),
    uploadedBy: d.uploadedBy,
    reviewedAt: d.reviewedAt?.toISOString() ?? null,
    reviewedBy: d.reviewedBy,
    rejectReason: d.rejectReason,
    version: d.version,
    allowedActions,
  };
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly access: DocumentAccessService,
    private readonly athleteAccess: AthleteAccessService,
    private readonly extensions: AthleteExtensions,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly competitions: CompetitionScopeService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly accessLog: DataAccessLogService,
    private readonly outbox: OutboxService,
    private readonly emails: EmailRequestService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    // Загрузка файла документа: у кого есть право загрузки или внесения согласий, представитель, сам спортсмен.
    const canUpload = async (user: AuthUser): Promise<boolean> =>
      user.emailVerified &&
      ((await this.policy.holdsAnywhere(user, 'document.upload')) ||
        (await this.policy.holdsAnywhere(user, 'consent.record')) ||
        (await this.athleteAccess.hasRelations(user)));
    this.files.registerUploadPolicy('DOCUMENT', canUpload);
    this.files.registerUploadPolicy('CONSENT_SCAN', canUpload);
    // Скачивание файла документа напрямую по fileId — те же правила, что у документа.
    const canDownload = async (
      user: AuthUser,
      file: { id: string; uploadedById: string | null },
    ): Promise<boolean> => {
      const doc = await this.db.document.findUnique({ where: { fileId: file.id } });
      if (!doc) return file.uploadedById === user.id;
      return !doc.deletedAt && (await this.access.canView(user, doc));
    };
    this.files.registerAccessPolicy('DOCUMENT', canDownload);
    this.files.registerAccessPolicy('CONSENT_SCAN', canDownload);
    this.extensions.registerDocumentCheck(async (tx, athleteId, documentId) => {
      const doc = await tx.document.findFirst({ where: { id: documentId, athleteId, deletedAt: null } });
      return doc !== null;
    });
    this.extensions.registerMergeParticipant(async (tx, source, target) => {
      await tx.document.updateMany({
        where: { athleteId: source.athleteId },
        data: { athleteId: target.athleteId },
      });
    });
  }

  private async actions(user: AuthUser, d: Row): Promise<string[]> {
    const actions = ['document.view'];
    if (d.deletedAt === null && (await this.access.canVerify(user, d))) actions.push('document.verify');
    if (d.uploadedById === user.id && canDelete(d.status)) actions.push('document.delete');
    return actions;
  }

  async list(user: AuthUser, q: DocumentsQuery): Promise<Page<DocumentDto>> {
    const visibility = await this.access.visibilityFilter(user);
    const cursor = decodeCursor(q.cursor);
    const and: Prisma.DocumentWhereInput[] = [{ deletedAt: null }];
    if (visibility !== 'all') and.push(visibility);
    if (cursor) {
      const at = new Date(cursor.k);
      and.push({ OR: [{ uploadedAt: { lt: at } }, { uploadedAt: at, id: { lt: cursor.id } }] });
    }
    const rows = await this.db.document.findMany({
      where: {
        AND: and,
        athleteId: q.athleteId,
        organizationId: q.organizationId,
        competitionId: q.competitionId,
        status: q.status,
        typeCode: q.typeCode,
      },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: INCLUDE,
    });
    const page = toPage(
      rows,
      q.limit,
      (r) => ({ k: r.uploadedAt.toISOString(), id: r.id }),
      (r) => r,
    );
    return {
      data: await Promise.all(page.data.map(async (r) => toDto(r, await this.actions(user, r)))),
      page: page.page,
    };
  }

  /** Загрузка документа: владелец — спортсмен или организация; заявка — Phase 4. */
  private async assertCanUpload(user: AuthUser, input: DocumentCreate): Promise<void> {
    const { athleteId, organizationId, applicationId } = input.owner;
    if (applicationId)
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'owner.applicationId', code: 'not_supported' }],
      });
    if (athleteId) {
      if (await this.access.isRelated(user, athleteId)) return;
      await this.athleteAccess.assert(user, 'document.upload', athleteId);
      return;
    }
    await this.policy.assert(user, 'document.upload', await this.orgScopes.scopeOf(organizationId));
  }

  async create(user: AuthUser, input: DocumentCreate): Promise<DocumentDto> {
    await this.assertCanUpload(user, input);
    if (input.competitionId && !(await this.competitions.exists(input.competitionId)))
      throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'competitionId', code: 'not_found' }] });
    if (input.expirationDate && isExpired(input.expirationDate, today()))
      throw new DomainError('DOCUMENT_EXPIRED', { expirationDate: input.expirationDate });
    const id = await this.db.tx(async (tx) => {
      const type = await tx.documentType.findUnique({ where: { code: input.typeCode } });
      if (!type)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'typeCode', code: 'invalid_code' }] });
      const file = await this.files.attachableFile(tx, input.fileId, user.id);
      const purposeOk =
        file &&
        (file.purpose === 'DOCUMENT' || (file.purpose === 'CONSENT_SCAN' && type.code === 'CONSENT_SCAN'));
      if (!file || !purposeOk)
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'fileId', code: 'invalid_file' }] });
      if (!mimeAllowed(type.allowedMime, file.mimeType))
        throw new DomainError('UNSUPPORTED_FILE_TYPE', { allowed: type.allowedMime.split(',') });
      if (Number(file.sizeBytes) > type.maxSizeBytes)
        throw new DomainError('FILE_TOO_LARGE', { maxSizeBytes: type.maxSizeBytes });
      if (await tx.document.findUnique({ where: { fileId: file.id } }))
        throw new DomainError('VALIDATION_FAILED', { fields: [{ path: 'fileId', code: 'invalid_file' }] });
      const doc = await tx.document.create({
        data: {
          id: uuidv7(),
          typeCode: type.code,
          athleteId: input.owner.athleteId ?? null,
          organizationId: input.owner.organizationId ?? null,
          competitionId: input.competitionId ?? null,
          fileId: file.id,
          expirationDate: input.expirationDate ? toDate(input.expirationDate) : null,
          uploadedById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'document.uploaded',
        entityType: 'Document',
        entityId: doc.id,
        organizationId: doc.organizationId,
        competitionId: doc.competitionId,
        after: {
          typeCode: doc.typeCode,
          athleteId: doc.athleteId,
          organizationId: doc.organizationId,
          fileId: doc.fileId,
          expirationDate: input.expirationDate ?? null,
        },
      });
      return doc.id;
    });
    const created = await this.db.document.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return toDto(created, await this.actions(user, created));
  }

  /** Отказ в доступе фиксируется в журнале; владелец не виден — 404, виден — 403 (PERMISSIONS.md, 7). */
  private async loadViewable(user: AuthUser, id: string): Promise<Row> {
    const doc = await this.db.document.findFirst({ where: { id, deletedAt: null }, include: INCLUDE });
    if (!doc) throw new DomainError('NOT_FOUND', { resource: 'document' });
    if (await this.access.canView(user, doc)) return doc;
    await this.accessLog.record('DENIED', 'Document', doc.id, doc.competitionId);
    if (await this.access.ownerVisible(user, doc))
      throw new DomainError('FORBIDDEN', { permission: 'document.view' });
    throw new DomainError('NOT_FOUND', { resource: 'document' });
  }

  async get(user: AuthUser, id: string): Promise<DocumentDto> {
    const doc = await this.loadViewable(user, id);
    await this.accessLog.record('VIEW', 'Document', doc.id, doc.competitionId);
    return toDto(doc, await this.actions(user, doc));
  }

  async downloadUrl(user: AuthUser, id: string): Promise<DownloadUrl> {
    const doc = await this.loadViewable(user, id);
    return this.files.grantedDownloadUrl(doc.fileId, {
      resourceType: 'Document',
      resourceId: doc.id,
      competitionId: doc.competitionId,
    });
  }

  async transition(
    user: AuthUser,
    id: string,
    version: number,
    req: DocumentTransitionRequest,
  ): Promise<DocumentDto> {
    const doc = await this.db.document.findFirst({ where: { id, deletedAt: null } });
    if (!doc) throw new DomainError('NOT_FOUND', { resource: 'document' });
    const verifyScopes = await this.access.verifyScopes(doc);
    if (!(await this.policy.canAny(user, 'document.verify', verifyScopes))) {
      if (await this.access.canView(user, doc))
        throw new DomainError('FORBIDDEN', { permission: 'document.verify' });
      throw new DomainError('NOT_FOUND', { resource: 'document' });
    }
    const check = checkReview(doc.status, req.to);
    if (!check.ok) {
      if (check.code === 'DOCUMENT_ALREADY_REVIEWED')
        throw new DomainError('DOCUMENT_ALREADY_REVIEWED', { status: doc.status });
      throw new DomainError('INVALID_TRANSITION', { from: doc.status, to: req.to, allowed: check.allowed });
    }
    if (check.reasonRequired && !req.reason) throw new DomainError('REASON_REQUIRED');
    await this.db.tx(async (tx) => {
      const decided = req.to !== 'UNDER_REVIEW';
      const { count } = await tx.document.updateMany({
        where: { id, version },
        data: {
          status: req.to,
          reviewedById: decided ? user.id : undefined,
          reviewedAt: decided ? new Date() : undefined,
          rejectReason: req.to === 'REJECTED' ? (req.reason ?? null) : undefined,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict(doc.version);
      await this.audit.record(tx, {
        action: 'document.status_changed',
        entityType: 'Document',
        entityId: id,
        competitionId: doc.competitionId,
        before: { status: doc.status },
        after: { status: req.to },
        reason: req.reason ?? null,
      });
      if (req.to === 'REJECTED')
        await this.notifyRejected(tx, doc.id, doc.typeCode, doc.uploadedById, req.reason ?? '');
    });
    return this.get(user, id);
  }

  /** «Документ отклонён» — загрузившему: событие для уведомлений (Phase 4) и письмо сразу. */
  private async notifyRejected(
    tx: Tx,
    documentId: string,
    typeCode: string,
    uploadedById: string | null,
    reason: string,
  ): Promise<void> {
    await this.outbox.enqueue(tx, {
      type: 'document.rejected',
      aggregate: { type: 'Document', id: documentId },
      payload: { documentId },
    });
    const uploader = uploadedById ? await tx.user.findUnique({ where: { id: uploadedById } }) : null;
    if (!uploader?.email) return;
    const type = await tx.documentType.findUniqueOrThrow({ where: { code: typeCode } });
    const locale = uploader.locale === 'en' ? 'en' : 'ru';
    await this.emails.request(tx, {
      template: 'document.rejected',
      to: uploader.email,
      userId: uploader.id,
      locale,
      params: {
        documentType: locale === 'en' ? type.nameEn : type.nameRu,
        reason,
        documentsUrl: `${this.env.APP_URL.replace(/\/$/, '')}/${locale}/documents`,
      },
    });
  }

  /** Удалить может загрузивший, пока документ не взят на проверку (мягкое удаление). */
  async remove(user: AuthUser, id: string): Promise<void> {
    const doc = await this.loadViewable(user, id);
    if (doc.uploadedById !== user.id) throw new DomainError('FORBIDDEN', { reason: 'not_uploader' });
    if (!canDelete(doc.status))
      throw new DomainError('INVALID_TRANSITION', { from: doc.status, to: 'DELETED', allowed: [] });
    await this.db.tx(async (tx) => {
      await tx.document.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'document.deleted',
        entityType: 'Document',
        entityId: id,
        before: { status: doc.status },
        after: { deleted: true },
      });
    });
  }

  /** Документ — скан согласия этого спортсмена, не отклонён и не просрочен (для бумажного согласия). */
  async assertConsentScan(tx: Tx, athleteId: string, documentId: string): Promise<void> {
    const doc = await tx.document.findFirst({ where: { id: documentId, athleteId, deletedAt: null } });
    if (!doc || doc.typeCode !== 'CONSENT_SCAN' || doc.status === 'REJECTED' || doc.status === 'EXPIRED')
      throw new DomainError('VALIDATION_FAILED', {
        fields: [{ path: 'documentId', code: 'invalid_document' }],
      });
  }
}
