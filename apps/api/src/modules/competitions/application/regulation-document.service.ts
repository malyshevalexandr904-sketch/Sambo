// Автоматическое положение турнира (правки 05.11.2026, п. 8): сведения из заявки организатора и из турнира на
// платформе подставляются в фирменный шаблон «Цифровое Самбо» (domain/regulation-document.ts) и отдаются PDF.
// Положение не хранится: каждый запрос собирает его по актуальным данным, поэтому правки администратора (сроки,
// категории, взвешивание, судьи) сразу попадают в документ.
import { Inject, Injectable } from '@nestjs/common';
import { CompetitionRequestProposal } from '@sde/contracts';
import type { Prisma } from '@sde/db';
import type { Env } from '@sde/server-kit';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { ENV } from '../../../config/config.module';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildRegulation,
  type RegulationAgeGroup,
  type RegulationAgePolicy,
  type RegulationContact,
  type RegulationFacts,
  type RegulationGender,
  type RegulationWeight,
} from '../domain/regulation-document';
import { CompetitionRequestsService } from './competition-requests.service';
import { CompetitionsService } from './competitions.service';
import { renderRegulationPdf } from './regulation-pdf';

const PERSON_SELECT = {
  displayName: true,
  person: { select: { lastName: true, firstName: true, middleName: true } },
} as const;

/** «Иванов Иван Иванович» из анкеты, иначе имя в профиле. */
function fullName(
  u: {
    displayName: string;
    person: { lastName: string; firstName: string; middleName: string | null } | null;
  } | null,
): string | null {
  if (!u) return null;
  if (!u.person) return u.displayName;
  return [u.person.lastName, u.person.firstName, u.person.middleName].filter(Boolean).join(' ');
}

const ORGANIZER_SELECT = {
  name: true,
  city: true,
  address: true,
  contactEmail: true,
  contactPhone: true,
  website: true,
} satisfies Prisma.OrganizationSelect;

const COMPETITION_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  timezone: true,
  registrationStartsAt: true,
  registrationEndsAt: true,
  requirementsMd: true,
  contactInfo: true,
  weighInFailureOutcome: true,
  organizer: { select: ORGANIZER_SELECT },
  venue: { select: { name: true, address: true, city: true } },
  categories: {
    where: { status: { notIn: ['MERGED', 'CANCELLED'] } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      gender: true,
      ageGroupId: true,
      agePolicy: true,
      ageFrom: true,
      ageTo: true,
      birthYearFrom: true,
      birthYearTo: true,
      weightKind: true,
      weightLowerGrams: true,
      weightUpperGrams: true,
    },
  },
  weighInWindows: {
    orderBy: { startsAt: 'asc' },
    select: { name: true, startsAt: true, endsAt: true, kind: true },
  },
  requirements: {
    where: { kind: 'DOCUMENT', documentTypeCode: { not: null } },
    select: { documentType: { select: { nameRu: true } } },
  },
  staff: {
    where: { status: 'ACTIVE', role: { code: { in: ['CHIEF_REFEREE', 'SECRETARY'] } } },
    orderBy: { createdAt: 'asc' },
    select: { role: { select: { code: true } }, user: { select: PERSON_SELECT } },
  },
  request: { select: { proposal: true } },
} satisfies Prisma.CompetitionSelect;

type CompetitionRow = Prisma.CompetitionGetPayload<{ select: typeof COMPETITION_SELECT }>;

const dateOnly = (d: Date): string => d.toISOString().slice(0, 10);

const PUBLIC_CACHE_MS = 60_000;
const PUBLIC_CACHE_SIZE = 50;

export interface RegulationPdf {
  content: Buffer;
  /** Имя файла латиницей (для старых клиентов) и по-русски (filename*). */
  fileName: string;
  fileNameRu: string;
}

@Injectable()
export class RegulationDocumentService {
  constructor(
    private readonly db: PrismaService,
    private readonly competitions: CompetitionsService,
    private readonly requests: CompetitionRequestsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get appUrl(): string {
    return this.env.APP_URL.replace(/\/$/, '');
  }

  /** Сборка PDF занимает ~0,3 с: публичная страница популярного турнира получает один и тот же файл минуту. */
  private readonly publicCache = new Map<string, { at: number; pdf: RegulationPdf }>();

  /** Публичное положение опубликованного турнира (черновик скрыт, как и сам турнир). */
  async forPublic(slug: string): Promise<RegulationPdf> {
    const now = Date.now();
    const cached = this.publicCache.get(slug);
    if (cached && now - cached.at < PUBLIC_CACHE_MS) return cached.pdf;
    const pdf = await this.buildPublic(slug);
    if (this.publicCache.size >= PUBLIC_CACHE_SIZE) {
      for (const [key, v] of this.publicCache)
        if (now - v.at >= PUBLIC_CACHE_MS) this.publicCache.delete(key);
      if (this.publicCache.size >= PUBLIC_CACHE_SIZE) this.publicCache.clear();
    }
    this.publicCache.set(slug, { at: now, pdf });
    return pdf;
  }

  private async buildPublic(slug: string): Promise<RegulationPdf> {
    const row = await this.db.competition.findFirst({
      where: { slug, deletedAt: null, status: { not: 'DRAFT' } },
      select: COMPETITION_SELECT,
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return this.render(await this.competitionFacts(row), row.slug);
  }

  /** Положение для персонала и платформы: черновик турнира — с пометкой «ПРОЕКТ». */
  async forCompetition(user: AuthUser, id: string): Promise<RegulationPdf> {
    await this.competitions.get(user, id);
    const row = await this.db.competition.findFirst({
      where: { id, deletedAt: null },
      select: COMPETITION_SELECT,
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition' });
    return this.render(await this.competitionFacts(row), row.slug);
  }

  /** Проект положения по заявке на проведение — сразу после подачи, чтобы организатор видел готовый документ. */
  async forRequest(user: AuthUser, id: string): Promise<RegulationPdf> {
    const dto = await this.requests.get(user, id);
    const row = await this.db.competitionRequest.findUnique({
      where: { id },
      select: { proposal: true, organization: { select: ORGANIZER_SELECT } },
    });
    if (!row) throw new DomainError('NOT_FOUND', { resource: 'competition_request' });
    const p = CompetitionRequestProposal.parse(row.proposal);
    const facts: RegulationFacts = {
      draft: true,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      timezone: p.timezone,
      place: { city: null, venue: dto.venue?.name ?? null, address: p.address ?? dto.venue?.address ?? null },
      organizer: organizerFacts(row.organization),
      responsible: responsibleOf(p),
      chiefReferee: null,
      chiefSecretary: null,
      matCount: p.matCount ?? null,
      genderMode: p.gender ?? null,
      agePolicy: 'BY_BIRTH_YEAR',
      ageGroups: await this.templateAgeGroups(p.ageGroupIds ?? [], p.gender ?? null),
      registration:
        p.registrationStartsAt && p.registrationEndsAt
          ? { startsAt: p.registrationStartsAt, endsAt: p.registrationEndsAt }
          : null,
      weighIns: [],
      extraDocuments: [],
      extraConditionsMd: null,
      weighInFailureOutcome: null,
      pageUrl: null,
      platformUrl: this.appUrl,
      generatedAt: new Date(),
    };
    return this.render(facts, `zayavka-${id.slice(0, 8)}`);
  }

  // ---------- Сборка сведений ----------

  private async competitionFacts(row: CompetitionRow): Promise<RegulationFacts> {
    const proposal = row.request ? CompetitionRequestProposal.safeParse(row.request.proposal) : null;
    const p = proposal?.success ? proposal.data : null;
    const staffName = (code: string) => fullName(row.staff.find((s) => s.role.code === code)?.user ?? null);
    const contact = (row.contactInfo ?? null) as { name?: string; email?: string; phone?: string } | null;
    let ageGroups = categoryAgeGroups(row.categories);
    let agePolicy: RegulationAgePolicy = row.categories[0]?.agePolicy ?? 'BY_BIRTH_YEAR';
    if (ageGroups.length === 0 && p?.ageGroupIds?.length) {
      ageGroups = await this.templateAgeGroups(p.ageGroupIds, p.gender ?? null);
      agePolicy = 'BY_BIRTH_YEAR';
    }
    return {
      draft: row.status === 'DRAFT',
      name: row.name,
      startDate: dateOnly(row.startDate),
      endDate: dateOnly(row.endDate),
      timezone: row.timezone,
      place: {
        city: row.venue?.city ?? null,
        venue: row.venue?.name ?? null,
        address: row.venue?.address ?? p?.address ?? null,
      },
      organizer: organizerFacts(row.organizer),
      responsible:
        (p ? responsibleOf(p) : null) ??
        (contact?.name
          ? { name: contact.name, phone: contact.phone ?? null, email: contact.email ?? null }
          : null),
      chiefReferee: staffName('CHIEF_REFEREE'),
      chiefSecretary: staffName('SECRETARY'),
      matCount: p?.matCount ?? null,
      genderMode: p?.gender ?? null,
      agePolicy,
      ageGroups,
      registration: {
        startsAt: row.registrationStartsAt.toISOString(),
        endsAt: row.registrationEndsAt.toISOString(),
      },
      weighIns: row.weighInWindows.map((w) => ({
        name: w.name,
        startsAt: w.startsAt.toISOString(),
        endsAt: w.endsAt.toISOString(),
        official: w.kind === 'OFFICIAL',
      })),
      extraDocuments: [
        ...new Set(row.requirements.flatMap((r) => (r.documentType ? [r.documentType.nameRu] : []))),
      ],
      extraConditionsMd: row.requirementsMd,
      weighInFailureOutcome: row.weighInFailureOutcome,
      pageUrl: `${this.appUrl}/ru/tournaments/${row.slug}`,
      platformUrl: this.appUrl,
      generatedAt: new Date(),
    };
  }

  /** Шаблонные возрастные группы заявки с их весовыми категориями (по выбранному полу участников). */
  private async templateAgeGroups(
    ids: string[],
    mode: RegulationFacts['genderMode'],
  ): Promise<RegulationAgeGroup[]> {
    if (ids.length === 0) return [];
    const groups = await this.db.ageGroup.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        ageFrom: true,
        ageTo: true,
        weightCategories: {
          where: { deletedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { limitGrams: 'asc' }],
          select: { gender: true, kind: true, limitGrams: true },
        },
      },
    });
    const byId = new Map(groups.map((g) => [g.id, g]));
    return ids.flatMap((id) => {
      const g = byId.get(id);
      if (!g) return [];
      const weightsOf = (gender: RegulationGender): RegulationWeight[] =>
        g.weightCategories
          .filter((w) => w.gender === gender)
          .map((w) => ({ kind: w.kind, grams: w.limitGrams }));
      const male = weightsOf('MALE');
      const female = weightsOf('FEMALE');
      const divisions: RegulationAgeGroup['divisions'] =
        mode === 'BOYS'
          ? [{ gender: 'MALE', weights: male }]
          : mode === 'GIRLS'
            ? [{ gender: 'FEMALE', weights: female }]
            : mode === 'MIXED'
              ? [{ gender: null, weights: male.length > 0 ? male : female }]
              : [
                  { gender: 'MALE', weights: male },
                  { gender: 'FEMALE', weights: female },
                ];
      return [{ ageFrom: g.ageFrom, ageTo: g.ageTo, birthYearFrom: null, birthYearTo: null, divisions }];
    });
  }

  private async render(facts: RegulationFacts, slug: string): Promise<RegulationPdf> {
    const content = await renderRegulationPdf(buildRegulation(facts));
    const safeName = facts.name
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return {
      content,
      fileName: `polozhenie-${slug.replace(/[^a-z0-9-]/gi, '')}.pdf`,
      fileNameRu: `Положение — ${safeName}.pdf`,
    };
  }
}

function organizerFacts(
  o: Prisma.OrganizationGetPayload<{ select: typeof ORGANIZER_SELECT }>,
): RegulationFacts['organizer'] {
  return {
    name: o.name,
    city: o.city,
    address: o.address,
    email: o.contactEmail,
    phone: o.contactPhone,
    website: o.website,
  };
}

function responsibleOf(p: CompetitionRequestProposal): RegulationContact | null {
  const r = p.responsible;
  if (!r) return null;
  return {
    name: r.kind === 'CONTACT' ? r.fullName : r.displayName,
    phone: r.phone ?? null,
    email: r.email ?? null,
  };
}

/** Категории турнира → возрастные группы (по шаблону или границам возраста) с весами по полу. */
export function categoryAgeGroups(rows: CompetitionRow['categories']): RegulationAgeGroup[] {
  const groups = new Map<string, RegulationAgeGroup>();
  for (const c of rows) {
    const key = c.ageGroupId ?? `${c.agePolicy}|${c.ageFrom}|${c.ageTo}|${c.birthYearFrom}|${c.birthYearTo}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        ageFrom: c.ageFrom,
        ageTo: c.ageTo,
        birthYearFrom: c.birthYearFrom,
        birthYearTo: c.birthYearTo,
        divisions: [],
      };
      groups.set(key, g);
    }
    let d = g.divisions.find((x) => x.gender === c.gender);
    if (!d) {
      d = { gender: c.gender, weights: [] };
      g.divisions.push(d);
    }
    const grams = c.weightKind === 'ABOVE' ? c.weightLowerGrams : c.weightUpperGrams;
    if (grams !== null) d.weights.push({ kind: c.weightKind, grams });
  }
  for (const g of groups.values())
    g.divisions.sort((a, b) => (a.gender === b.gender ? 0 : a.gender === 'MALE' ? -1 : 1));
  return [...groups.values()];
}
