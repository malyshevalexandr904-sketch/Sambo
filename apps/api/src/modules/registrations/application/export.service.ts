// Выгрузка списка участников в CSV (API.md, 5.3): для Excel — UTF-8 с BOM, «;», заголовки на языке пользователя.
// XLSX и PDF — Phase 11 (реестр форматов выгрузки, ARCHITECTURE.md, 22).
import { Injectable } from '@nestjs/common';
import { entriesExportFileName, type EntriesExportQuery, type Locale, todayIn } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit';
import { CompetitionScopeService } from '../../competitions';
import { toCsv } from '../domain/csv';

const HEADERS: Record<Locale, string[]> = {
  ru: [
    '№',
    'Фамилия',
    'Имя',
    'Отчество',
    'Дата рождения',
    'Пол',
    'Разряд',
    'Клуб',
    'Тренер',
    'Регион',
    'Представительство',
    'Категория',
    'Заявленная категория',
    'Заявленный вес, кг',
    'Статус участия',
    'Статус заявки',
  ],
  en: [
    'No.',
    'Last name',
    'First name',
    'Middle name',
    'Date of birth',
    'Gender',
    'Rank',
    'Club',
    'Coach',
    'Region',
    'Represents',
    'Category',
    'Declared category',
    'Declared weight, kg',
    'Entry status',
    'Application status',
  ],
};

const GENDER: Record<Locale, Record<string, string>> = {
  ru: { MALE: 'М', FEMALE: 'Ж' },
  en: { MALE: 'M', FEMALE: 'F' },
};

const ENTRY_STATUS: Record<Locale, Record<string, string>> = {
  ru: { PENDING: 'На рассмотрении', APPROVED: 'Одобрено', REJECTED: 'Отклонено', WITHDRAWN: 'Снят' },
  en: { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' },
};

const APPLICATION_STATUS: Record<Locale, Record<string, string>> = {
  ru: {
    DRAFT: 'Черновик',
    SUBMITTED: 'Подана',
    UNDER_REVIEW: 'На проверке',
    APPROVED: 'Одобрена',
    REJECTED: 'Отклонена',
    WAITING_DOCUMENTS: 'Возвращена',
    CANCELLED: 'Отозвана',
  },
  en: {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    WAITING_DOCUMENTS: 'Returned',
    CANCELLED: 'Cancelled',
  },
};

const EXPORT_INCLUDE = {
  category: { select: { nameRu: true, nameEn: true } },
  declaredCategory: { select: { nameRu: true, nameEn: true } },
  application: { select: { status: true } },
  representationOrg: { select: { shortName: true } },
} satisfies Prisma.EntryInclude;
type ExportEntry = Prisma.EntryGetPayload<{ include: typeof EXPORT_INCLUDE }>;

/** Строка выгрузки: снимок данных спортсмена на момент заявки, статусы участия и заявки. */
function exportRow(e: ExportEntry, n: number, locale: Locale): (string | number | null | undefined)[] {
  const name = (c: { nameRu: string; nameEn: string }) => (locale === 'en' ? c.nameEn : c.nameRu);
  return [
    n,
    e.snapLastName,
    e.snapFirstName,
    e.snapMiddleName,
    e.snapBirthDate.toISOString().slice(0, 10),
    GENDER[locale][e.snapGender],
    e.snapRankCode,
    e.snapClubName,
    e.snapCoachName,
    e.snapRegionName,
    e.representationOrg?.shortName ?? null,
    name(e.category),
    name(e.declaredCategory),
    e.declaredWeightGrams === null
      ? null
      : (e.declaredWeightGrams / 1000).toString().replace('.', locale === 'ru' ? ',' : '.'),
    ENTRY_STATUS[locale][e.status],
    APPLICATION_STATUS[locale][e.application.status],
  ];
}

@Injectable()
export class EntriesExportService {
  constructor(
    private readonly db: PrismaService,
    private readonly competitions: CompetitionScopeService,
    private readonly audit: AuditService,
  ) {}

  async csv(
    competitionId: string,
    q: EntriesExportQuery,
    locale: Locale,
  ): Promise<{ fileName: string; content: string }> {
    const competition = await this.competitions.require(competitionId);
    const rows = await this.db.entry.findMany({
      where: {
        competitionId,
        categoryId: q.categoryId,
        status: q.status,
        // Черновики клубов секретариату не видны и в выгрузку не попадают.
        application: { status: { not: 'DRAFT' } },
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { snapLastName: 'asc' },
        { snapFirstName: 'asc' },
        { id: 'asc' },
      ],
      include: EXPORT_INCLUDE,
    });
    const content = toCsv(
      HEADERS[locale],
      rows.map((e, i) => exportRow(e, i + 1, locale)),
    );
    // Выгрузка персональных данных — в журнал аудита (раздел 35), без самих данных.
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        action: 'entry.exported',
        entityType: 'Competition',
        entityId: competitionId,
        competitionId,
        after: { rows: rows.length, categoryId: q.categoryId ?? null, status: q.status ?? null },
      }),
    );
    return { fileName: entriesExportFileName(competition.slug, todayIn(competition.timezone)), content };
  }
}
