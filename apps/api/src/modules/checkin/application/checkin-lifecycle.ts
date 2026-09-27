// Прибытие в жизненном цикле турнира: начало мандатной комиссии создаёт строки прибытия, позднее одобрение —
// строку спортсмена; для допуска модуль отдаёт проверку CHECK_IN, для дашборда — число прибывших.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdmissionSources, type CheckOutcome, evaluateCheckIn } from '../../admission';
import { CompetitionExtensions } from '../../competitions';
import { OutboxService } from '../../outbox';
import { CHECK_IN_PHASE } from '../domain/checkin-rules';
import { CheckInService } from './checkin.service';

@Injectable()
export class CheckInLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly checkins: CheckInService,
    private readonly sources: AdmissionSources,
    private readonly competitions: CompetitionExtensions,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.sources.register('CHECK_IN', async (tx, competition, subjects) => {
      const rows = await tx.checkIn.findMany({
        where: { competitionId: competition.id, athleteId: { in: subjects.map((s) => s.athleteId) } },
        select: { athleteId: true, status: true },
      });
      const byAthlete = new Map(rows.map((r) => [r.athleteId, r.status]));
      return new Map<string, CheckOutcome>(
        subjects.map((s) => [s.entryId, evaluateCheckIn(byAthlete.get(s.athleteId))]),
      );
    });
    this.competitions.registerEffect(async ({ tx, competition, from, to }) => {
      if (from === 'REGISTRATION_CLOSED' && to === 'CHECK_IN')
        await this.checkins.ensureRows(tx, competition.id);
    });
    this.outbox.subscribe('registration.entry_decided', async (tx, e) => {
      if (e.payload.decision !== 'APPROVED' || !e.competitionId) return;
      const c = await tx.competition.findUnique({ where: { id: e.competitionId }, select: { status: true } });
      if (!c || !CHECK_IN_PHASE.includes(c.status)) return;
      const entry = await tx.entry.findUniqueOrThrow({
        where: { id: e.payload.entryId },
        select: { athleteId: true },
      });
      await this.checkins.ensureRows(tx, e.competitionId, [entry.athleteId]);
    });
    this.competitions.registerCounters(async (tx, competitionId) => ({
      arrived: await (tx ?? this.db).checkIn.count({
        where: {
          competitionId,
          status: 'ARRIVED',
          athlete: { entries: { some: { competitionId, status: 'APPROVED' } } },
        },
      }),
    }));
  }
}
