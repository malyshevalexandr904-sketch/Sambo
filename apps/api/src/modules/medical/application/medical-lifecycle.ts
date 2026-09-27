// Медицинский допуск в допуске участия: источник проверки MEDICAL. Персонал видит только итог проверки.
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AdmissionSources, type CheckOutcome, evaluateMedical } from '../../admission';

@Injectable()
export class MedicalLifecycle implements OnModuleInit {
  constructor(private readonly sources: AdmissionSources) {}

  onModuleInit(): void {
    this.sources.register('MEDICAL', async (tx, competition, subjects) => {
      const rows = await tx.medicalClearance.findMany({
        where: {
          athleteId: { in: subjects.map((s) => s.athleteId) },
          OR: [{ competitionId: null }, { competitionId: competition.id }],
        },
        select: { athleteId: true, status: true, validUntil: true, createdAt: true },
      });
      return new Map<string, CheckOutcome>(
        subjects.map((s) => [
          s.entryId,
          evaluateMedical(
            rows
              .filter((r) => r.athleteId === s.athleteId)
              .map((r) => ({ ...r, validUntil: r.validUntil.toISOString().slice(0, 10) })),
            competition.startDate,
          ),
        ]),
      );
    });
  }
}
