// Потребитель `athlete.import_requested` (API.md, 4.4): читает файл из приватного хранилища, строит
// предпросмотр (ошибки по полям, тренеры, дубли) и переводит задание в PARSED или FAILED. Идемпотентен.
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { EVENT_SCHEMAS, fullName } from '@sde/contracts';
import { findAthleteDuplicates, type Prisma, type PrismaClient } from '@sde/db';
import type { Env, Logger } from '@sde/server-kit';
import type { Job } from 'bullmq';
import type { OutboxJob } from '../outbox/dispatcher';
import { analyzeRows, type ImportLookups } from './analyze';
import { ImportFileProblem, readImportFile } from './parse';

export const IMPORT_CONSUMER = 'athlete-import';

export class ImportConsumer {
  constructor(
    private readonly db: PrismaClient,
    private readonly s3: S3Client,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job<OutboxJob>): Promise<void> {
    const { eventId, traceId } = job.data;
    const done = await this.db.processedEvent.findUnique({
      where: { consumer_eventId: { consumer: IMPORT_CONSUMER, eventId } },
    });
    if (done) return;
    const event = await this.db.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return;
    const { importJobId } = EVENT_SCHEMAS['athlete.import_requested'].parse(event.payload);
    const importJob = await this.db.importJob.findUnique({
      where: { id: importJobId },
      include: { file: true },
    });
    if (importJob?.status === 'PENDING') {
      const bytes = await this.read(importJob.file.storageKey);
      await this.parse(importJob.id, importJob.organizationId, importJob.file.mimeType, bytes);
    }
    await this.db.processedEvent.create({ data: { consumer: IMPORT_CONSUMER, eventId } });
    this.logger.info({ eventId, traceId, importJobId }, 'Import file parsed');
  }

  private async read(storageKey: string): Promise<Uint8Array> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.env.STORAGE_BUCKET_PRIVATE, Key: storageKey }),
    );
    if (!res.Body) throw new Error('Import file body is empty');
    return res.Body.transformToByteArray();
  }

  async parse(
    importJobId: string,
    organizationId: string,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<void> {
    let rows;
    try {
      rows = readImportFile(bytes, mimeType);
    } catch (e) {
      if (!(e instanceof ImportFileProblem)) throw e;
      await this.db.importJob.update({
        where: { id: importJobId },
        data: {
          status: 'FAILED',
          errorCode: e.code,
          report: { details: e.details } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      return;
    }
    const report = await analyzeRows(rows, await this.lookups(organizationId));
    await this.db.importJob.updateMany({
      where: { id: importJobId, status: 'PENDING' },
      data: { status: 'PARSED', report: report as unknown as Prisma.InputJsonValue, parsedAt: new Date() },
    });
  }

  private async lookups(organizationId: string): Promise<ImportLookups> {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const ranks = await this.db.sportRank.findMany({ select: { code: true } });
    return {
      rankCodes: new Set(ranks.map((r) => r.code)),
      coachByEmail: async (email) => {
        const coach = await this.db.coachProfile.findFirst({
          where: {
            status: 'ACTIVE',
            person: { user: { email } },
            memberships: { some: { organizationId, OR: [{ validTo: null }, { validTo: { gte: today } }] } },
          },
          include: { person: true },
        });
        return coach ? { id: coach.id, name: fullName(coach.person) } : null;
      },
      duplicates: (person) => findAthleteDuplicates(this.db, person),
    };
  }
}
