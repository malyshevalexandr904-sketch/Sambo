// Публичная витрина турнира (API.md, 5.9; ADR-15): только опубликованные турниры и белый список полей.
// Read-модель собирается запросами с явным select — служебные поля и персональные данные сюда не попадают.
import { Injectable } from '@nestjs/common';
import {
  type CompetitionMediaDto,
  type CompetitionStatus,
  type PublicBracketParticipant,
  type PublicBracketsDto,
  type PublicCategoryBracket,
  type PublicLiveDto,
  publicSectionsOf,
  type Page,
  type PublicCompetition,
  type PublicCompetitionsQuery,
  type PublicCompetitionSummary,
} from '@sde/contracts';
import type { Prisma } from '@sde/db';
import { DomainError } from '../../../common/errors/domain-error';
import { decodeCursor, toPage } from '../../../common/http/http';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BracketsService } from '../../brackets';
import { CompetitionStagesService, registrationWindow } from '../../competitions';
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
  competitionType: true,
  ratingConfig: { select: { publicDeltas: true } },
  discipline: { select: { nameRu: true, nameEn: true } },
  regulation: { select: { storageKey: true, status: true } },
  posterTemplate: true,
  liveStreamUrl: true,
  weighInWindows: {
    where: { kind: 'OFFICIAL' },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { name: true, startsAt: true, endsAt: true },
  },
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
    private readonly bracketsView: BracketsService,
    private readonly stages: CompetitionStagesService,
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
      competitionType: row.competitionType,
      ratingPublic: row.competitionType === 'RATED' && row.ratingConfig?.publicDeltas === true,
      posterTemplate: row.posterTemplate,
      weighInWindows: row.weighInWindows.map((w) => ({
        name: w.name,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
      })),
      liveStreamUrl: row.liveStreamUrl,
    };
  }

  private async requireId(
    slug: string,
  ): Promise<{ id: string; status: CompetitionStatus; liveStreamUrl: string | null }> {
    const row = await this.db.competition.findFirst({
      where: { ...PUBLIC_WHERE, slug },
      select: { id: true, status: true, liveStreamUrl: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return row;
  }

  /**
   * Турнирные сетки (правки 05.11.2026): опубликованные жеребьёвки категорий, схватки и итоговые протоколы. Имя
   * участника — только с согласием на распространение ПДн (как на табло), иначе null.
   */
  async brackets(slug: string): Promise<PublicBracketsDto> {
    const c = await this.requireId(slug);
    if (!publicSectionsOf(c.status).includes('brackets')) return { categories: [] };
    const categories = await this.db.competitionCategory.findMany({
      where: { competitionId: c.id, status: { notIn: ['MERGED', 'CANCELLED'] } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        code: true,
        nameRu: true,
        nameEn: true,
        gender: true,
        weightKind: true,
        weightLowerGrams: true,
        weightUpperGrams: true,
      },
    });
    const draws = await this.db.draw.findMany({
      where: { competitionId: c.id, status: 'PUBLISHED' },
      select: { id: true, categoryId: true, format: true, slots: { select: { entryId: true } } },
    });
    const results = await this.db.categoryResult.findMany({
      where: { competitionId: c.id, status: { in: ['PUBLISHED', 'AMENDED'] } },
      select: {
        categoryId: true,
        placements: {
          orderBy: [{ place: 'asc' }, { id: 'asc' }],
          select: { place: true, medal: true, entryId: true, wins: true, losses: true },
        },
      },
    });
    const entryIds = [
      ...new Set([
        ...draws.flatMap((d) => d.slots.flatMap((x) => (x.entryId ? [x.entryId] : []))),
        ...results.flatMap((r) => r.placements.map((p) => p.entryId)),
      ]),
    ];
    const entries = entryIds.length
      ? await this.db.entry.findMany({
          where: { id: { in: entryIds } },
          select: {
            id: true,
            publicName: true,
            snapClubName: true,
            snapRegionName: true,
            athlete: { select: { personId: true } },
          },
        })
      : [];
    const personIds = [...new Set(entries.map((e) => e.athlete.personId))];
    const consents = personIds.length
      ? await this.db.consent.findMany({
          where: {
            subjectPersonId: { in: personIds },
            revokedAt: null,
            template: { kind: 'PD_DISTRIBUTION' },
            OR: [{ competitionId: null }, { competitionId: c.id }],
          },
          select: { subjectPersonId: true },
        })
      : [];
    const named = new Set(consents.map((x) => x.subjectPersonId));
    const participant = new Map(
      entries.map((e): [string, PublicBracketParticipant] => [
        e.id,
        {
          entryId: e.id,
          name: named.has(e.athlete.personId) ? e.publicName : null,
          club: e.snapClubName,
          region: e.snapRegionName,
        },
      ]),
    );
    const nameOf = (entryId: string | null): string | null =>
      entryId ? (participant.get(entryId)?.name ?? null) : null;
    const out: PublicCategoryBracket[] = [];
    for (const cat of categories) {
      const draw = draws.find((d) => d.categoryId === cat.id);
      const result = results.find((r) => r.categoryId === cat.id);
      const nodes = draw ? ((await this.bracketsView.view(draw.id)) ?? []) : [];
      const item: PublicCategoryBracket = {
        code: cat.code,
        name: { ru: cat.nameRu, en: cat.nameEn },
        gender: cat.gender,
        weight: { kind: cat.weightKind, lowerGrams: cat.weightLowerGrams, upperGrams: cat.weightUpperGrams },
        format: draw?.format ?? null,
        participants: draw
          ? draw.slots.flatMap((x) => {
              const p = x.entryId ? participant.get(x.entryId) : undefined;
              return p ? [p] : [];
            })
          : [],
        matches: nodes
          .filter((n) => !(n.red.bye || n.blue.bye))
          .map((n) => ({
            key: n.key,
            stage: n.stage,
            group: n.group,
            round: n.round,
            position: n.position,
            label: n.label,
            red: nameOf(n.red.entryId),
            blue: nameOf(n.blue.entryId),
            winner: n.winnerSide,
            status: n.match?.status ?? n.status,
            score:
              n.match?.result && n.match.result.redScore !== null && n.match.result.blueScore !== null
                ? `${n.match.result.redScore}:${n.match.result.blueScore}`
                : null,
          })),
        placements: result
          ? result.placements.map((p) => ({
              place: p.place,
              medal: p.medal,
              entryId: p.entryId,
              wins: p.wins,
              losses: p.losses,
            }))
          : null,
      };
      // Участники итогового протокола, которых нет в сетке (перевод между категориями), — тоже в списке.
      for (const p of result?.placements ?? []) {
        const info = participant.get(p.entryId);
        if (info && !item.participants.some((x) => x.entryId === p.entryId)) item.participants.push(info);
      }
      out.push(item);
    }
    return { categories: out.filter((x) => x.format !== null || x.placements !== null) };
  }

  /** Прямая трансляция: ссылка на видео и ковры турнира (табло каждого ковра — `/api/public/v1/mats/{id}`). */
  async live(slug: string): Promise<PublicLiveDto> {
    const c = await this.requireId(slug);
    if (!publicSectionsOf(c.status).includes('live')) return { streamUrl: null, mats: [] };
    const mats = await this.db.mat.findMany({
      where: { competitionId: c.id },
      orderBy: [{ number: 'asc' }],
      select: { id: true, number: true, name: true },
    });
    return { streamUrl: c.liveStreamUrl, mats };
  }

  /** Фото и видео завершённого турнира. */
  async media(slug: string): Promise<CompetitionMediaDto[]> {
    const c = await this.requireId(slug);
    if (!publicSectionsOf(c.status).includes('media')) return [];
    return this.stages.listMedia(c.id);
  }
}
