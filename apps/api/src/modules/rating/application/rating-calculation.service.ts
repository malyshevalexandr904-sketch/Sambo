// Расчёт рейтинга по схватке из api (docs/RATING_ARCHITECTURE.md, 6): тот же расчёт, что выполняет worker по событию
// подтверждения результата (@sde/rating), с аудитом и outbox api — действие записывается от имени пользователя
// запроса. Используется повтором расчёта администратором (фаза 14).
import { Injectable } from '@nestjs/common';
import { type RatingCalculationOutcome, RatingCalculator } from '@sde/rating';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { OutboxService } from '../../outbox';

@Injectable()
export class RatingCalculationService {
  private readonly calculator: RatingCalculator;

  constructor(prisma: PrismaService, audit: AuditService, outbox: OutboxService) {
    this.calculator = new RatingCalculator((fn) => prisma.tx(fn), {
      record: (tx, entry) => audit.record(tx, entry),
      enqueue: (tx, event) => outbox.enqueue(tx, event),
    });
  }

  calculate(matchId: string): Promise<RatingCalculationOutcome> {
    return this.calculator.calculate(matchId);
  }

  releasePending(athleteIds: readonly string[]): Promise<RatingCalculationOutcome[]> {
    return this.calculator.releasePending(athleteIds);
  }
}
