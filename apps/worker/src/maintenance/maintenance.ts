// Обслуживание БД и хранилища (DATABASE.md, 5, 8, 9): партиции журналов, сроки хранения служебных данных.
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { type PrismaClient, uuidv7 } from '@sde/db';
import type { Env, Logger } from '@sde/server-kit';

const DAY = 24 * 60 * 60 * 1000;

export const MAINTENANCE_JOBS = {
  ensurePartitions: { every: DAY },
  cleanupTokens: { every: DAY },
  cleanupOutbox: { every: DAY },
  cleanupPendingUploads: { every: 60 * 60 * 1000 },
  expireDocuments: { every: 60 * 60 * 1000 },
  closeRegistrations: { every: 5 * 60 * 1000 },
  cleanupSyncLog: { every: DAY },
} as const;

export type MaintenanceJob = keyof typeof MAINTENANCE_JOBS;

export class Maintenance {
  constructor(
    private readonly db: PrismaClient,
    private readonly s3: S3Client,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  async run(job: MaintenanceJob): Promise<void> {
    switch (job) {
      case 'ensurePartitions':
        return this.ensurePartitions();
      case 'cleanupTokens':
        return this.cleanupTokens();
      case 'cleanupOutbox':
        return this.cleanupOutbox();
      case 'cleanupPendingUploads':
        return this.cleanupPendingUploads();
      case 'expireDocuments':
        await this.expireDocuments();
        return;
      case 'closeRegistrations':
        await this.closeRegistrations();
        return;
      case 'cleanupSyncLog':
        await this.cleanupSyncLog();
        return;
    }
  }

  /** Партиции AuditLog и DataAccessLog на 3 месяца вперёд. Функция SECURITY DEFINER, DDL у роли приложения нет. */
  private async ensurePartitions(): Promise<void> {
    for (const table of ['audit_log', 'data_access_log']) {
      const rows = await this.db.$queryRaw<
        { created: number }[]
      >`SELECT ensure_monthly_partitions(${table}, current_date, 3) AS created`;
      this.logger.info({ table, created: rows[0]?.created ?? 0 }, 'Partitions ensured');
    }
  }

  /** RefreshToken и VerificationToken — 30 дней после истечения (DATABASE.md, 9). */
  private async cleanupTokens(): Promise<void> {
    const before = new Date(Date.now() - 30 * DAY);
    // Сначала разрываем цепочки ротации, чтобы удалить токены без нарушения FK.
    await this.db.refreshToken.updateMany({
      where: { expiresAt: { lt: before }, replacedById: { not: null } },
      data: { replacedById: null },
    });
    const refresh = await this.db.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });
    const verification = await this.db.verificationToken.deleteMany({ where: { expiresAt: { lt: before } } });
    this.logger.info({ refresh: refresh.count, verification: verification.count }, 'Expired tokens removed');
  }

  /** OutboxEvent и ProcessedEvent — 30 дней после обработки. */
  private async cleanupOutbox(): Promise<void> {
    const before = new Date(Date.now() - 30 * DAY);
    const outbox = await this.db.outboxEvent.deleteMany({
      where: { status: 'DISPATCHED', dispatchedAt: { lt: before } },
    });
    const processed = await this.db.processedEvent.deleteMany({ where: { processedAt: { lt: before } } });
    this.logger.info({ outbox: outbox.count, processed: processed.count }, 'Old outbox records removed');
  }

  /** Незавершённые загрузки — через 24 часа (DATABASE.md, 5). */
  private async cleanupPendingUploads(): Promise<void> {
    const stale = await this.db.storedFile.findMany({
      where: { status: 'PENDING_UPLOAD', createdAt: { lt: new Date(Date.now() - DAY) } },
      take: 500,
    });
    for (const file of stale) {
      const key = file.bucket === 'PUBLIC_MEDIA' ? `incoming/${file.id}` : file.storageKey;
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.STORAGE_BUCKET_PRIVATE, Key: key }));
      } catch (e) {
        this.logger.warn({ err: e, fileId: file.id }, 'Failed to delete stale upload object');
        continue;
      }
      await this.db.storedFile.update({
        where: { id: file.id },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
    }
    if (stale.length > 0) this.logger.info({ count: stale.length }, 'Stale uploads removed');
  }

  /**
   * Проверенный документ с истёкшим сроком действия → EXPIRED (ARCHITECTURE.md, 16.4). В сам день окончания
   * документ ещё действует. Переход пишется в аудит от имени системы.
   */
  async expireDocuments(today: Date = new Date(new Date().toISOString().slice(0, 10))): Promise<number> {
    const due = await this.db.document.findMany({
      where: { status: 'VERIFIED', deletedAt: null, expirationDate: { lt: today } },
      select: { id: true, competitionId: true },
      take: 1000,
    });
    let expired = 0;
    for (const doc of due) {
      await this.db.$transaction(async (tx) => {
        const { count } = await tx.document.updateMany({
          where: { id: doc.id, status: 'VERIFIED' },
          data: { status: 'EXPIRED', version: { increment: 1 } },
        });
        if (count === 0) return;
        expired += 1;
        await tx.auditLog.create({
          data: {
            id: uuidv7(),
            actorType: 'SYSTEM',
            action: 'document.expired',
            entityType: 'Document',
            entityId: doc.id,
            competitionId: doc.competitionId,
            before: { status: 'VERIFIED' },
            after: { status: 'EXPIRED' },
            traceId: 'maintenance:expireDocuments',
          },
        });
      });
    }
    if (expired > 0) this.logger.info({ count: expired }, 'Documents expired');
    return expired;
  }

  /**
   * Срок регистрации истёк — регистрация турнира закрывается (ARCHITECTURE.md, 16.1: переход
   * REGISTRATION_OPEN → REGISTRATION_CLOSED выполняет фоновая задача в `registrationEndsAt`), а с ней и
   * категории. Только турниры, право записи которых у облака; переход — в аудит от имени системы и в outbox.
   * Заявки после срока не принимаются и без этой задачи: окно проверяет API.
   */
  async closeRegistrations(now: Date = new Date()): Promise<number> {
    const due = await this.db.competition.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        deletedAt: null,
        registrationEndsAt: { lte: now },
        writeLease: { holderType: 'CLOUD' },
      },
      select: { id: true, organizerOrganizationId: true },
      take: 100,
    });
    let closed = 0;
    for (const c of due) {
      await this.db.$transaction(async (tx) => {
        const { count } = await tx.competition.updateMany({
          where: { id: c.id, status: 'REGISTRATION_OPEN', registrationEndsAt: { lte: now } },
          data: { status: 'REGISTRATION_CLOSED', version: { increment: 1 } },
        });
        if (count === 0) return;
        closed += 1;
        await tx.competitionCategory.updateMany({
          where: { competitionId: c.id, status: 'REGISTRATION' },
          data: { status: 'CLOSED', version: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            id: uuidv7(),
            actorType: 'SYSTEM',
            action: 'competition.status_changed',
            entityType: 'Competition',
            entityId: c.id,
            competitionId: c.id,
            organizationId: c.organizerOrganizationId,
            before: { status: 'REGISTRATION_OPEN' },
            after: { status: 'REGISTRATION_CLOSED' },
            reason: 'registration_deadline',
            traceId: 'maintenance:closeRegistrations',
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: uuidv7(),
            type: 'competition.status_changed',
            aggregateType: 'Competition',
            aggregateId: c.id,
            competitionId: c.id,
            traceId: 'maintenance:closeRegistrations',
            payload: { competitionId: c.id, from: 'REGISTRATION_OPEN', to: 'REGISTRATION_CLOSED' },
          },
        });
      });
    }
    if (closed > 0) this.logger.info({ count: closed }, 'Registrations closed');
    return closed;
  }

  /**
   * Журнал синхронизации в облаке нужен, пока турнир может уйти на площадочный узел и вернуться:
   * записи старше 30 дней удаляются у турниров, право записи которых у облака (DATABASE.md, 9).
   */
  async cleanupSyncLog(now: Date = new Date()): Promise<number> {
    const { count } = await this.db.syncLog.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - 30 * DAY) },
        competitionId: {
          in: (
            await this.db.competitionWriteLease.findMany({
              where: { holderType: 'CLOUD' },
              select: { competitionId: true },
            })
          ).map((l) => l.competitionId),
        },
      },
    });
    if (count > 0) this.logger.info({ count }, 'Old sync log records removed');
    return count;
  }
}
