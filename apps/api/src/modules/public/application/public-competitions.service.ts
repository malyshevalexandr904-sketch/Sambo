// Публичная витрина турнира (API.md, 5.9; ADR-15): только опубликованные турниры и белый список полей.
// Read-модель собирается запросами с явным select — служебные поля и персональные данные сюда не попадают.
import { Injectable } from '@nestjs/common';
import {
  type Page,
  type PublicCompetition,
  type PublicCompetitionsQuery,
  type PublicCompetitionSummary,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { registrationWindow } from '../../competitions';
import { FilesService } from '../../files';

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  status: true,
  level: true,
  startDate: true,
  endDate: true,
  timezone: true,
  registrationStartsAt: true,
  registrationEndsAt: true,
  organizer: { select: { name: true, city: true, region: { select: { nameRu: true, nameEn: true } } } },
  venue: {
    select: { name: true, address: true, city: true, region: { select: { nameRu: true, nameEn: true } } },
  },
  logo: { select: { storageKey: true, status: true } },
} satisfies Prisma.CompetitionSelect;

type SummaryRow = Prisma.CompetitionGetPayload<{ select: typeof SUMMARY_SELECT }>;

const PUBLIC_WHERE: Prisma.CompetitionWhereInput = { deletedAt: null, status: { not: 'DRAFT' } };
const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

/** Поля страницы турнира: белый список (ADR-15) — никаких участников, только число одобренных участий. */
const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  descriptionMd: true,
  requirementsMd: true,
  contactInfo: true,
  cancelReason: true,
  discipline: { select: { nameRu: true, nameEn: true } },
  regulation: { select: { storageKey: true, status: true } },
  requirements: {
    orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    select: {
      kind: true,
      consentKind: true,
      mandatory: true,
      noteMd: true,
      category: { select: { code: true } },
      documentType: { select: { nameRu: true, nameEn: true } },
    },
  },
  categories: {
    where: { status: { notIn: ['MERGED', 'CANCELLED'] } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      nameRu: true,
      nameEn: true,
      gender: true,
      status: true,
      agePolicy: true,
      ageFrom: true,
      ageTo: true,
      birthYearFrom: true,
      birthYearTo: true,
      ageReferenceDate: true,
      weightKind: true,
      weightLowerGrams: true,
      weightUpperGrams: true,
    },
  },
} satisfies Prisma.CompetitionSelect;

type PublicCategoryRow = Prisma.CompetitionCategoryGetPayload<{
  select: (typeof DETAIL_SELECT)['categories']['select'];
}>;

function toPublicCategory(
  c: PublicCategoryRow,
  participants: number,
): PublicCompetition['categories'][number] {
  return {
    code: c.code,
    name: { ru: c.nameRu, en: c.nameEn },
    gender: c.gender,
    status: c.status,
    age: {
      policy: c.agePolicy,
      ageFrom: c.ageFrom,
      ageTo: c.ageTo,
      birthYearFrom: c.birthYearFrom,
      birthYearTo: c.birthYearTo,
      referenceDate: c.ageReferenceDate ? dateOnly(c.ageReferenceDate) : null,
    },
    weight: { kind: c.weightKind, lowerGrams: c.weightLowerGrams, upperGrams: c.weightUpperGrams },
    participants,
  };
}

@Injectable()
export class PublicCompetitionsService {
  constructor(
    private readonly db: PrismaService,
    private readonly files: FilesService,
  ) {}

  private summary(r: SummaryRow, now: Date): PublicCompetitionSummary {
    const region = r.venue?.region ?? r.organizer.region;
    return {
      slug: r.slug,
      name: r.name,
      shortName: r.shortName,
      status: r.status,
      level: r.level,
      startDate: dateOnly(r.startDate),
      endDate: dateOnly(r.endDate),
      timezone: r.timezone,
      registrationStartsAt: r.registrationStartsAt.toISOString(),
      registrationEndsAt: r.registrationEndsAt.toISOString(),
      registrationOpenNow: registrationWindow(r, now) === 'OPEN',
      organizerName: r.organizer.name,
      city: r.venue?.city ?? r.organizer.city,
      regionName: region ? { ru: region.nameRu, en: region.nameEn } : null,
      logoUrl: r.logo?.status === 'AVAILABLE' ? this.files.publicUrl(r.logo.storageKey) : null,
    };
  }

  async list(q: PublicCompetitionsQuery): Promise<Page<PublicCompetitionSummary>> {
    const and: Prisma.CompetitionWhereInput[] = [PUBLIC_WHERE];
    if (q.status) and.push({ status: q.status });
    if (q.regionId)
      and.push({
        OR: [{ venue: { regionId: q.regionId } }, { venueId: null, organizer: { regionId: q.regionId } }],
      });
    if (q.from) and.push({ endDate: { gte: new Date(`${q.from}T00:00:00Z`) } });
    if (q.to) and.push({ startDate: { lte: new Date(`${q.to}T00:00:00Z`) } });
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      const at = new Date(`${cursor.k}T00:00:00Z`);
      and.push({ OR: [{ startDate: { gt: at } }, { startDate: at, id: { gt: cursor.id } }] });
    }
    const rows = await this.db.competition.findMany({
      where: { AND: and },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      select: SUMMARY_SELECT,
    });
    const now = new Date();
    return toPage(
      rows,
      q.limit,
      (r) => ({ k: dateOnly(r.startDate), id: r.id }),
      (r) => this.summary(r, now),
    );
  }

  async get(slug: string): Promise<PublicCompetition> {
    const row = await this.db.competition.findFirst({
      where: { ...PUBLIC_WHERE, slug },
      select: DETAIL_SELECT,
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    const counts = await this.db.entry.groupBy({
      by: ['categoryId'],
      where: { competitionId: row.id, status: 'APPROVED' },
      _count: { _all: true },
    });
    const participants = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const contact = (row.contactInfo ?? null) as PublicCompetition['contacts'];
    return {
      ...this.summary(row, new Date()),
      descriptionMd: row.descriptionMd,
      discipline: { ru: row.discipline.nameRu, en: row.discipline.nameEn },
      venue: row.venue ? { name: row.venue.name, address: row.venue.address, city: row.venue.city } : null,
      regulationUrl:
        row.regulation?.status === 'AVAILABLE' ? this.files.publicUrl(row.regulation.storageKey) : null,
      requirementsMd: row.requirementsMd,
      requirements: row.requirements.map((r) => ({
        kind: r.kind,
        categoryCode: r.category?.code ?? null,
        documentType: r.documentType ? { ru: r.documentType.nameRu, en: r.documentType.nameEn } : null,
        consentKind: r.consentKind,
        mandatory: r.mandatory,
        noteMd: r.noteMd,
      })),
      categories: row.categories.map((c) => toPublicCategory(c, participants.get(c.id) ?? 0)),
      contacts: contact,
      cancelReason: row.status === 'CANCELLED' ? row.cancelReason : null,
    };
  }
}
