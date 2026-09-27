// Взвешивание в допуске: источник проверки WEIGHT. Итог пересчитывается из попыток в транзакции пересчёта
// допуска — так перевод категории и окончание окон повторного взвешивания сразу видны в допуске.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AdmissionSources, type CheckOutcome, evaluateWeight } from '../../admission';
import { WeighInRecords } from './weighin-records';
import { WeighInService } from './weighin.service';

@Injectable()
export class WeighInLifecycle implements OnModuleInit {
  constructor(
    private readonly sources: AdmissionSources,
    private readonly records: WeighInRecords,
    private readonly weighins: WeighInService,
  ) {}

  onModuleInit(): void {
    this.sources.register('WEIGHT', async (tx, competition, subjects, now) => {
      const facts = await this.weighins.competitionFacts(tx, competition.id);
      const derived = await this.records.refresh(
        tx,
        facts,
        subjects.map((s) => s.entryId),
        now,
      );
      return new Map<string, CheckOutcome>(
        subjects.map((s) => {
          const d = derived.get(s.entryId);
          const attempt = d?.decisive?.attempt;
          return [
            s.entryId,
            evaluateWeight(
              d && {
                status: d.status,
                weightGrams: attempt?.weightGrams ?? null,
                lowerGrams: d.limits.lowerGrams,
                upperGrams: d.limits.upperGrams,
              },
            ),
          ];
        }),
      );
    });
  }
}
