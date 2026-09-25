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
}
