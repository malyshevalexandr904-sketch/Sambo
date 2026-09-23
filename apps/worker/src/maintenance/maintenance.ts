// Обслуживание БД и хранилища (DATABASE.md, 5, 8, 9): партиции журналов, сроки хранения служебных данных.
import { DeleteObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@sde/db';
import type { Env, Logger } from '@sde/server-kit';

const DAY = 24 * 60 * 60 * 1000;

export const MAINTENANCE_JOBS = {
  ensurePartitions: { every: DAY },
  cleanupTokens: { every: DAY },
  cleanupOutbox: { every: DAY },
  cleanupPendingUploads: { every: 60 * 60 * 1000 },
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
    }
  }

  /** Партиции AuditLog и DataAccessLog на 3 месяца вперёд. Функция SECURITY DEFINER, DDL у роли приложения нет. */
  private async ensurePartitions(): Promise<void> {
    for (const table of ['audit_log', 'data_access_log']) {
      const rows = await this.db.$queryRaw<{ created: number }[]>`SELECT ensure_monthly_partitions(${table}, current_date, 3) AS created`;
      this.logger.info({ table, created: rows[0]?.created ?? 0 }, 'Partitions ensured');
    }
  }

  /** RefreshToken и VerificationToken — 30 дней после истечения (DATABASE.md, 9). */
  private async cleanupTokens(): Promise<void> {
    const before = new Date(Date.now() - 30 * DAY);
    // Сначала разрываем цепочки ротации, чтобы удалить токены без нарушения FK.
    await this.db.refreshToken.updateMany({ where: { expiresAt: { lt: before }, replacedById: { not: null } }, data: { replacedById: null } });
    const refresh = await this.db.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });
    const verification = await this.db.verificationToken.deleteMany({ where: { expiresAt: { lt: before } } });
    this.logger.info({ refresh: refresh.count, verification: verification.count }, 'Expired tokens removed');
  }

  /** OutboxEvent и ProcessedEvent — 30 дней после обработки. */
  private async cleanupOutbox(): Promise<void> {
    const before = new Date(Date.now() - 30 * DAY);
    const outbox = await this.db.outboxEvent.deleteMany({ where: { status: 'DISPATCHED', dispatchedAt: { lt: before } } });
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
      await this.db.storedFile.update({ where: { id: file.id }, data: { status: 'DELETED', deletedAt: new Date() } });
    }
    if (stale.length > 0) this.logger.info({ count: stale.length }, 'Stale uploads removed');
  }
}
