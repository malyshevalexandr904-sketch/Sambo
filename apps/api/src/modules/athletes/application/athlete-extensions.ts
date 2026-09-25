// Точки подключения других модулей к спортсмену без циклических зависимостей (ARCHITECTURE.md, 4.2):
// согласия отдают статус для карточки, документы проверяют ссылку и участвуют в слиянии дублей.
import { Injectable } from '@nestjs/common';
import type { ConsentsStatus } from '@sde/contracts';
import type { Tx } from '@sde/db';
import { consentsStatus } from '../domain/athlete-rules';

export interface MergeSide {
  athleteId: string;
  personId: string;
}

/** Перенос данных модуля с исходного профиля на целевой в транзакции слияния. */
export type AthleteMergeParticipant = (tx: Tx, source: MergeSide, target: MergeSide) => Promise<void>;

/** Статус согласий для людей-спортсменов: personId → статус по видам. */
export type ConsentStatusProvider = (personIds: string[]) => Promise<Map<string, ConsentsStatus>>;

/** Документ принадлежит спортсмену (для ссылки на приказ о разряде). */
export type AthleteDocumentCheck = (tx: Tx, athleteId: string, documentId: string) => Promise<boolean>;

@Injectable()
export class AthleteExtensions {
  private consentStatus: ConsentStatusProvider | null = null;
  private documentCheck: AthleteDocumentCheck | null = null;
  private readonly mergeParticipants: AthleteMergeParticipant[] = [];

  registerConsentStatus(provider: ConsentStatusProvider): void {
    this.consentStatus = provider;
  }

  registerDocumentCheck(check: AthleteDocumentCheck): void {
    this.documentCheck = check;
  }

  registerMergeParticipant(participant: AthleteMergeParticipant): void {
    this.mergeParticipants.push(participant);
  }

  async consentsStatusOf(personIds: string[]): Promise<Map<string, ConsentsStatus>> {
    const fromProvider = this.consentStatus ? await this.consentStatus(personIds) : new Map();
    return new Map(personIds.map((id) => [id, fromProvider.get(id) ?? consentsStatus([])]));
  }

  async documentBelongs(tx: Tx, athleteId: string, documentId: string): Promise<boolean> {
    return this.documentCheck ? this.documentCheck(tx, athleteId, documentId) : false;
  }

  async merge(tx: Tx, source: MergeSide, target: MergeSide): Promise<void> {
    for (const p of this.mergeParticipants) await p(tx, source, target);
  }
}
