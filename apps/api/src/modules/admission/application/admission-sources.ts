// Источники проверок допуска, которые зависят от модуля admission (прибытие, взвешивание, медицина): они
// регистрируют провайдеры при старте, поэтому admission их не импортирует (нет циклов модулей). Документы и
// согласия admission вызывает напрямую — эти модули ниже по слоям.
import { Injectable } from '@nestjs/common';
import type { CompetitionStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { CheckOutcome } from '../domain/admission-rules';

export interface AdmissionSubject {
  entryId: string;
  competitionId: string;
  athleteId: string;
  personId: string;
  applicationId: string;
  categoryId: string;
}

export interface AdmissionCompetition {
  id: string;
  status: CompetitionStatus;
  timezone: string;
  /** Дата начала турнира (YYYY-MM-DD): на неё действуют документы и медицинский допуск. */
  startDate: string;
  endDate: string;
}

export type SourceCheckKind = 'MEDICAL' | 'WEIGHT' | 'CHECK_IN';

/**
 * Итог проверки по участиям. Провайдер работает в транзакции пересчёта и может обновить свою проекцию
 * (например, закрыть повторное взвешивание после окончания окна).
 */
export type AdmissionSource = (
  tx: Tx,
  competition: AdmissionCompetition,
  subjects: AdmissionSubject[],
  now: Date,
) => Promise<Map<string, CheckOutcome>>;

@Injectable()
export class AdmissionSources {
  private readonly sources = new Map<SourceCheckKind, AdmissionSource>();

  register(kind: SourceCheckKind, source: AdmissionSource): void {
    this.sources.set(kind, source);
  }

  get(kind: SourceCheckKind): AdmissionSource | null {
    return this.sources.get(kind) ?? null;
  }
}
