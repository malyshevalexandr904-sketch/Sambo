// Импорт спортсменов (API.md, 4.4; G-14): файл разбирает worker (предпросмотр с ошибками и дублями),
// фиксация выполняется здесь теми же проверками, что и ручное создание, — построчно, с отчётом.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type ErrorCode,
  type ImportCommitRequest,
  type ImportCreate,
  type ImportFileError,
  type ImportJobDto,
  type ImportReport,
  type ImportRowResult,
} from '@sde/contracts';
import { type ImportJob, type Prisma, uuidv7 } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { FilesService } from '../../files';
import { OrganizationScopeService } from '../../organizations';
import { OutboxService } from '../../outbox';
import { AthleteLinksService } from './athlete-links.service';
import { AthletesService } from './athletes.service';

const IMPORT_REASON = 'Импорт из файла: пользователь подтвердил, что это другой человек';

type JobRow = ImportJob & { file: { originalName: string } };

function toDto(job: JobRow): ImportJobDto {
  return {
    id: job.id,
    organizationId: job.organizationId,
    status: job.status,
    fileName: job.file.originalName,
    errorCode: (job.errorCode as ImportFileError | null) ?? null,
    report: (job.report as unknown as ImportReport | null) ?? null,
    createdAt: job.createdAt.toISOString(),
    parsedAt: job.parsedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ImportsService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly orgScopes: OrganizationScopeService,
    private readonly files: FilesService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly athletes: AthletesService,
    private readonly links: AthleteLinksService,
  ) {}

  onModuleInit(): void {
    // Файл импорта загружает тот, у кого есть право импорта хотя бы в одной организации.
    this.files.registerUploadPolicy('IMPORT', (user) => this.policy.holdsAnywhere(user, 'athlete.import'));
  }

  async create(user: AuthUser, input: ImportCreate): Promise<ImportJobDto> {
    await this.athletes.assertTargetOrganization(user, input.organizationId, 'athlete.import');
    const id = await this.db.tx(async (tx) => {
      await this.files.assertAttachable(tx, input.fileId, user.id, 'IMPORT', 'fileId');
      const job = await tx.importJob.create({
        data: {
          id: uuidv7(),
          organizationId: input.organizationId,
          fileId: input.fileId,
          createdById: user.id,
        },
      });
      await this.audit.record(tx, {
        action: 'athlete.import_created',
        entityType: 'ImportJob',
        entityId: job.id,
        organizationId: input.organizationId,
        after: { fileId: input.fileId },
      });
      await this.outbox.enqueue(tx, {
        type: 'athlete.import_requested',
        aggregate: { type: 'ImportJob', id: job.id },
        payload: { importJobId: job.id },
      });
      return job.id;
    });
    return this.get(user, id);
  }

  /** Задание видит только его создатель. */
  async get(user: AuthUser, id: string): Promise<ImportJobDto> {
    const job = await this.db.importJob.findUnique({
      where: { id },
      include: { file: { select: { originalName: true } } },
    });
    if (!job || job.createdById !== user.id) throw new DomainError('NOT_FOUND', { resource: 'import' });
    return toDto(job);
  }

  /**
   * Фиксация: задание переводится в COMMITTED сразу (повторная фиксация невозможна), строки применяются
   * по одной в отдельных транзакциях, результат каждой — в отчёте. Дубли создаются только по явному CREATE.
   */
  async commit(user: AuthUser, id: string, req: ImportCommitRequest): Promise<ImportJobDto> {
    const job = await this.db.importJob.findUnique({ where: { id } });
    if (!job || job.createdById !== user.id) throw new DomainError('NOT_FOUND', { resource: 'import' });
    await this.policy.assert(user, 'athlete.import', await this.orgScopes.scopeOf(job.organizationId));
    const claimed = await this.db.importJob.updateMany({
      where: { id, status: 'PARSED' },
      data: { status: 'COMMITTED' },
    });
    if (claimed.count === 0)
      throw new DomainError('INVALID_TRANSITION', { from: job.status, to: 'COMMITTED', allowed: [] });
    const report = job.report as unknown as ImportReport;
    const byRow = new Map(report.rows.map((r) => [r.row, r]));
    const totals = { created: 0, linked: 0, skipped: 0, failed: 0 };
    const requested = new Map(req.rows.map((r) => [r.row, r]));
    for (const row of report.rows) {
      const choice = requested.get(row.row);
      let result: ImportRowResult;
      if (!choice || choice.action === 'SKIP') result = { action: 'SKIP', athleteId: null, error: null };
      else if (!row.data) result = { action: choice.action, athleteId: null, error: 'VALIDATION_FAILED' };
      else result = await this.applyRow(user, job.organizationId, row, choice);
      row.result = result;
      if (result.error) totals.failed += 1;
      else if (result.action === 'CREATE') totals.created += 1;
      else if (result.action === 'LINK') totals.linked += 1;
      else totals.skipped += 1;
    }
    for (const r of req.rows) if (!byRow.has(r.row)) totals.failed += 1;
    const finalReport: ImportReport = { ...report, results: totals };
    await this.db.tx(async (tx) => {
      await tx.importJob.update({
        where: { id },
        data: { report: finalReport as unknown as Prisma.InputJsonValue, completedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'athlete.import_committed',
        entityType: 'ImportJob',
        entityId: id,
        organizationId: job.organizationId,
        after: totals,
      });
    });
    return this.get(user, id);
  }

  private async applyRow(
    user: AuthUser,
    organizationId: string,
    row: ImportReport['rows'][number],
    choice: ImportCommitRequest['rows'][number],
  ): Promise<ImportRowResult> {
    const data = row.data;
    if (!data) return { action: choice.action, athleteId: null, error: 'VALIDATION_FAILED' };
    try {
      if (choice.action === 'LINK') {
        const athleteId = choice.athleteId as string;
        await this.links
          .addMembership(user, athleteId, {
            organizationId,
            validFrom: new Date().toISOString().slice(0, 10),
            isPrimary: false,
          })
          .catch((e: unknown) => {
            if (e instanceof DomainError && e.code === 'ALREADY_EXISTS') return;
            throw e;
          });
        return { action: 'LINK', athleteId, error: null };
      }
      const athleteId = await this.db.tx((tx) =>
        this.athletes.createInTx(
          tx,
          user,
          {
            person: {
              lastName: data.lastName,
              firstName: data.firstName,
              middleName: data.middleName,
              birthDate: data.birthDate,
              gender: data.gender,
            },
            organizationId,
            coachId: row.coach?.id,
            rank:
              data.sportRankCode && data.rankAssignedAt
                ? {
                    sportRankCode: data.sportRankCode,
                    assignedAt: data.rankAssignedAt,
                    orderRef: data.rankOrderRef,
                  }
                : undefined,
          },
          { confirmedCandidateIds: row.duplicates.map((d) => d.athleteId), confirmReason: IMPORT_REASON },
        ),
      );
      return { action: 'CREATE', athleteId, error: null };
    } catch (e) {
      if (e instanceof DomainError)
        return { action: choice.action, athleteId: null, error: e.code satisfies ErrorCode };
      throw e;
    }
  }
}
