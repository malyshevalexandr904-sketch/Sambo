// Когда пересчитывается допуск (DATABASE.md, 3.5): в транзакции изменения-повода — решения по участиям,
// перевод и объединение категорий, требования положения, документы и согласия. Переходы: начало мандатной
// комиссии пересчитывает турнир; категория готова к жеребьёвке, только когда допуск решён по всем участиям.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { EventType } from '@sde/contracts';
import type { Prisma, Tx } from '@sde/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CategoryExtensions, type CategoryTransitionCheck } from '../../categories';
import { CompetitionExtensions } from '../../competitions';
import { DocumentsService } from '../../documents';
import { OutboxService, type TxEvent } from '../../outbox';
import { AdmissionEngine } from './admission-engine';

@Injectable()
export class AdmissionLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly engine: AdmissionEngine,
    private readonly outbox: OutboxService,
    private readonly documents: DocumentsService,
    private readonly competitions: CompetitionExtensions,
    private readonly categories: CategoryExtensions,
  ) {}

  onModuleInit(): void {
    const sub = <T extends EventType>(
      type: T,
      where: (
        e: TxEvent<T>,
        tx: Tx,
      ) => Prisma.EntryWhereInput | null | Promise<Prisma.EntryWhereInput | null>,
    ): void =>
      this.outbox.subscribe(type, async (tx, e) => {
        const w = await where(e, tx);
        if (w) await this.engine.recompute(tx, w);
      });
    sub('registration.entry_decided', (e) => ({ id: e.payload.entryId }));
    sub('registration.entry_withdrawn', (e) => ({ id: e.payload.entryId }));
    sub('registration.entry_transferred', (e) => ({ id: e.payload.entryId }));
    sub('registration.application_decided', (e) => ({ applicationId: e.payload.applicationId }));
    sub('registration.application_cancelled', (e) => ({ applicationId: e.payload.applicationId }));
    sub('category.merged', (e) => ({ categoryId: e.payload.targetCategoryId }));
    sub('competition.requirements_changed', (e) => ({ competitionId: e.payload.competitionId }));
    sub('consent.given', (e) => ({ athlete: { personId: e.payload.personId } }));
    sub('consent.revoked', (e) => ({ athleteId: e.payload.athleteId }));
    sub('document.status_changed', (e, tx) => this.documentOwners(tx, e.payload.documentId));
    this.competitions.registerEffect(async ({ tx, competition, from, to }) => {
      if (from === 'REGISTRATION_CLOSED' && to === 'CHECK_IN')
        await this.engine.recompute(tx, { competitionId: competition.id });
    });
    this.competitions.registerCounters(async (tx, competitionId) => {
      const db = tx ?? this.db;
      const count = (status: 'ADMITTED' | 'NOT_ADMITTED') =>
        db.admission.count({ where: { competitionId, status, entry: { status: 'APPROVED' } } });
      return { admitted: await count('ADMITTED'), notAdmitted: await count('NOT_ADMITTED') };
    });
    this.categories.registerTransitionCheck(this.readyForDraw);
  }

  private async documentOwners(tx: Tx, documentId: string): Promise<Prisma.EntryWhereInput | null> {
    const { athleteId, applicationId } = await this.documents.owners(tx, documentId);
    const or: Prisma.EntryWhereInput[] = [];
    if (athleteId) or.push({ athleteId });
    if (applicationId) or.push({ applicationId });
    return or.length > 0 ? { OR: or } : null;
  }

  /**
   * К жеребьёвке — только с решённым допуском (ARCHITECTURE.md, 16.2): перед проверкой допуск категории
   * пересчитывается (например, истекли окна повторного взвешивания).
   */
  private readonly readyForDraw: CategoryTransitionCheck = async ({ tx, categoryId, to }) => {
    if (to !== 'READY_FOR_DRAW') return [];
    await this.engine.recompute(tx, { categoryId });
    const undecided = await tx.entry.count({
      where: {
        categoryId,
        status: 'APPROVED',
        OR: [{ admission: null }, { admission: { status: 'PENDING' } }],
      },
    });
    return undecided > 0 ? ['admission_pending'] : [];
  };
}
