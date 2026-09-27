// Пересчёт допуска (DATABASE.md, 3.5): синхронно, в транзакции изменения-повода. Факты берутся из модулей
// documents и consents и из зарегистрированных источников (прибытие, взвешивание, медицина); проекция
// Admission/AdmissionCheck пишется только при изменении — так журнал синхронизации не растёт от пересчётов.
import { Injectable } from '@nestjs/common';
import {
  ADMISSION_CHECK_KINDS,
  type AdmissionCheckKind,
  admissionStatusOf,
  type CompetitionStatus,
} from '@sde/contracts';
import { Prisma, type Tx } from '@sde/db';
import { ConsentsService } from '../../consents';
import { type AdmissionDocumentFact, DocumentsService } from '../../documents';
import { WriteLeaseService } from '../../venue-sync';
import {
  type CheckOutcome,
  checkChanged,
  evaluateConsents,
  evaluateDocuments,
  type MergedCheck,
  mergeCheck,
  type RequiredChecks,
  requiredChecks,
} from '../domain/admission-rules';
import {
  type AdmissionCompetition,
  AdmissionSources,
  type AdmissionSubject,
  type SourceCheckKind,
} from './admission-sources';

/** Турниры, где допуск ведётся: от регистрации до окончания соревнований. */
const ACTIVE: readonly CompetitionStatus[] = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECK_IN',
  'DRAWING',
  'SCHEDULED',
  'IN_PROGRESS',
];

const SOURCE_KINDS: readonly SourceCheckKind[] = ['MEDICAL', 'WEIGHT', 'CHECK_IN'];

const NO_SOURCE: CheckOutcome = { status: 'PENDING', reasonCode: null, reasonParams: null };

export type ComputedChecks = Map<AdmissionCheckKind, CheckOutcome>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

const ENTRY_SELECT = {
  id: true,
  competitionId: true,
  athleteId: true,
  applicationId: true,
  categoryId: true,
  status: true,
  athlete: { select: { personId: true } },
} satisfies Prisma.EntrySelect;

type EntryFact = Prisma.EntryGetPayload<{ select: typeof ENTRY_SELECT }>;

const toSubject = (e: EntryFact): AdmissionSubject => ({
  entryId: e.id,
  competitionId: e.competitionId,
  athleteId: e.athleteId,
  personId: e.athlete.personId,
  applicationId: e.applicationId,
  categoryId: e.categoryId,
});

const jsonOrNull = (v: Record<string, unknown> | null): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

const checkData = (c: MergedCheck) => ({
  status: c.status,
  reasonCode: c.reasonCode,
  reasonParams: jsonOrNull(c.reasonParams),
  waiverReason: c.waiverReason,
});

@Injectable()
export class AdmissionEngine {
  constructor(
    private readonly documents: DocumentsService,
    private readonly consents: ConsentsService,
    private readonly sources: AdmissionSources,
    private readonly leases: WriteLeaseService,
  ) {}

  /**
   * Пересчёт участий по условию: у одобренных проекция обновляется, у остальных строка допуска удаляется.
   * Турнир, право записи которого у площадочного узла, пропускается (ADR-21).
   */
  async recompute(tx: Tx, where: Prisma.EntryWhereInput, now = new Date()): Promise<void> {
    const entries = await tx.entry.findMany({
      where: { AND: [where, { competition: { status: { in: [...ACTIVE] } } }] },
      select: ENTRY_SELECT,
    });
    const byCompetition = new Map<string, EntryFact[]>();
    for (const e of entries)
      byCompetition.set(e.competitionId, [...(byCompetition.get(e.competitionId) ?? []), e]);
    for (const [competitionId, list] of byCompetition) {
      if (!(await this.leases.holds(tx, competitionId))) continue;
      const gone = list.filter((e) => e.status !== 'APPROVED').map((e) => e.id);
      if (gone.length > 0) await tx.admission.deleteMany({ where: { entryId: { in: gone } } });
      const approved = list.filter((e) => e.status === 'APPROVED').map(toSubject);
      if (approved.length === 0) continue;
      const competition = await this.competition(tx, competitionId);
      await this.persist(tx, competitionId, await this.evaluate(tx, competition, approved, now), now);
    }
  }

  async competition(tx: Tx, competitionId: string): Promise<AdmissionCompetition> {
    const c = await tx.competition.findUniqueOrThrow({
      where: { id: competitionId },
      select: { id: true, status: true, timezone: true, startDate: true, endDate: true },
    });
    return { ...c, startDate: dateOnly(c.startDate), endDate: dateOnly(c.endDate) };
  }

  /** Итоги проверок без записи (для участия, у которого проекции ещё нет). */
  async evaluate(
    tx: Tx,
    competition: AdmissionCompetition,
    subjects: AdmissionSubject[],
    now: Date,
  ): Promise<Map<string, ComputedChecks>> {
    const requirements = await tx.competitionRequirement.findMany({
      where: { competitionId: competition.id, mandatory: true },
      select: { categoryId: true, kind: true, documentTypeCode: true, consentKind: true, mandatory: true },
    });
    const required = new Map(subjects.map((s) => [s.entryId, requiredChecks(requirements, s.categoryId)]));
    const docs = await this.documentFacts(tx, competition.id, subjects, required);
    const needConsents = subjects.filter((s) => required.get(s.entryId)?.kinds.has('CONSENTS'));
    const consents =
      needConsents.length > 0
        ? await this.consents.activeKinds(
            tx,
            [...new Set(needConsents.map((s) => s.personId))],
            competition.id,
          )
        : new Map<string, Set<never>>();
    const fromSources = new Map<SourceCheckKind, Map<string, CheckOutcome>>();
    for (const kind of SOURCE_KINDS) {
      const need = subjects.filter((s) => required.get(s.entryId)?.kinds.has(kind));
      const source = this.sources.get(kind);
      if (need.length > 0 && source) fromSources.set(kind, await source(tx, competition, need, now));
    }
    const result = new Map<string, ComputedChecks>();
    for (const s of subjects) {
      const req = required.get(s.entryId) as RequiredChecks;
      const own = docs.filter((d) => d.athleteId === s.athleteId || d.applicationId === s.applicationId);
      const checks: ComputedChecks = new Map();
      for (const kind of ADMISSION_CHECK_KINDS) {
        if (!req.kinds.has(kind)) continue;
        if (kind === 'DOCUMENTS')
          checks.set(kind, evaluateDocuments(req.documentTypes, own, competition.startDate));
        else if (kind === 'INSURANCE')
          checks.set(kind, evaluateDocuments(req.insuranceTypes, own, competition.startDate));
        else if (kind === 'CONSENTS')
          checks.set(kind, evaluateConsents(req.consentKinds, consents.get(s.personId) ?? new Set()));
        else checks.set(kind, fromSources.get(kind as SourceCheckKind)?.get(s.entryId) ?? NO_SOURCE);
      }
      result.set(s.entryId, checks);
    }
    return result;
  }

  private async documentFacts(
    tx: Tx,
    competitionId: string,
    subjects: AdmissionSubject[],
    required: Map<string, RequiredChecks>,
  ): Promise<AdmissionDocumentFact[]> {
    const typeCodes = new Set<string>();
    for (const r of required.values())
      for (const t of [...r.documentTypes, ...r.insuranceTypes]) typeCodes.add(t);
    if (typeCodes.size === 0) return [];
    return this.documents.admissionFacts(tx, {
      athleteIds: [...new Set(subjects.map((s) => s.athleteId))],
      applicationIds: [...new Set(subjects.map((s) => s.applicationId))],
      typeCodes: [...typeCodes],
      competitionId,
    });
  }

  private async persist(
    tx: Tx,
    competitionId: string,
    computed: Map<string, ComputedChecks>,
    now: Date,
  ): Promise<void> {
    const stored = await tx.admission.findMany({
      where: { entryId: { in: [...computed.keys()] } },
      include: { checks: true },
    });
    const byEntry = new Map(stored.map((a) => [a.entryId, a]));
    for (const [entryId, checks] of computed) {
      const current = byEntry.get(entryId);
      const prev = new Map((current?.checks ?? []).map((c) => [c.kind, c]));
      const merged = new Map(
        [...checks].map(([kind, outcome]) => [kind, mergeCheck(prev.get(kind), outcome)]),
      );
      const status = admissionStatusOf([...merged.values()]);
      const decidedAt = status === 'PENDING' ? null : now;
      const admission =
        current ??
        (await tx.admission.create({
          data: { competitionId, entryId, status, decidedAt },
          include: { checks: true },
        }));
      if (current && current.status !== status)
        await tx.admission.update({ where: { id: current.id }, data: { status, decidedAt } });
      for (const [kind, next] of merged) {
        const before = prev.get(kind);
        if (!before)
          await tx.admissionCheck.create({
            data: { competitionId, admissionId: admission.id, kind, ...checkData(next) },
          });
        else if (checkChanged(before, next))
          await tx.admissionCheck.update({ where: { id: before.id }, data: checkData(next) });
      }
      const stale = [...prev.values()].filter((c) => !merged.has(c.kind)).map((c) => c.id);
      if (stale.length > 0) await tx.admissionCheck.deleteMany({ where: { id: { in: stale } } });
    }
  }
}
