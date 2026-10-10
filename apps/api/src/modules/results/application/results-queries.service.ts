// Чтение итогов (план Phase 7b, §1): вкладка турнира «Итоги» (категории с сеткой, сколько схваток решено и ждёт
// подтверждения, места и медали, можно ли публиковать) и история спортсмена в кабинете. Итоги видит весь персонал
// турнира (competition.view); историю — те, кто видит карточку спортсмена (организация, сам, представитель).
import { Injectable } from '@nestjs/common';
import type {
  AthleteHistoryDto,
  CategoryResultsDto,
  CategoryStatus,
  CompetitionResultsDto,
  Medal,
  PlacementDto,
} from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService, type ResourceScope } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { CategoryWorkflowService } from '../../categories';
import { CompetitionScopeService } from '../../competitions';

/** Категории с опубликованной сеткой: у них есть (или будут) итоги. */
export const DRAWN_STATUSES: readonly CategoryStatus[] = [
  'DRAWN',
  'IN_PROGRESS',
  'COMPLETED',
  'RESULTS_PUBLISHED',
];

const CATEGORY_SELECT = {
  id: true,
  competitionId: true,
  nameRu: true,
  nameEn: true,
  status: true,
  sortOrder: true,
  draws: { where: { status: 'PUBLISHED' as const }, select: { format: true } },
  result: {
    include: {
      placements: {
        include: {
          entry: { select: { publicName: true, snapClubName: true, snapRegionName: true, status: true } },
        },
        orderBy: [{ place: 'asc' as const }, { entryId: 'asc' as const }],
      },
      publishedBy: { select: { id: true, displayName: true } },
    },
  },
};

@Injectable()
export class ResultsQueriesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly categories: CategoryWorkflowService,
    private readonly competitions: CompetitionScopeService,
    private readonly athletes: AthleteAccessService,
  ) {}

  /** Счётчики схваток сетки по категориям: всего (кроме решённых без схватки), решено, ждёт подтверждения. */
  private async matchCounts(categoryIds: string[]) {
    const rows = await this.db.match.findMany({
      where: { categoryId: { in: categoryIds }, bracketNodeId: { not: null }, status: { not: 'CANCELLED' } },
      select: {
        categoryId: true,
        status: true,
        participants: { select: { entryId: true } },
        result: { select: { status: true } },
      },
    });
    const counts = new Map<string, { total: number; decided: number; awaiting: number }>();
    for (const m of rows) {
      const noMatch = m.status === 'FINISHED' && m.participants.some((p) => p.entryId === null);
      if (noMatch) continue;
      const c = counts.get(m.categoryId) ?? { total: 0, decided: 0, awaiting: 0 };
      c.total += 1;
      if (m.result?.status === 'PROVISIONAL') c.awaiting += 1;
      else if (m.result) c.decided += 1;
      counts.set(m.categoryId, c);
    }
    return counts;
  }

  private async categoryDtos(
    user: AuthUser,
    scope: ResourceScope,
    where: { competitionId: string } | { id: string },
  ): Promise<CategoryResultsDto[]> {
    const rows = await this.db.competitionCategory.findMany({
      where: { ...where, status: { in: [...DRAWN_STATUSES] } },
      select: CATEGORY_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const counts = await this.matchCounts(rows.map((r) => r.id));
    const mayPublish = await this.policy.can(user, 'result.publish', scope);
    return rows.map((c) => {
      const r = c.result;
      const n = counts.get(c.id) ?? { total: 0, decided: 0, awaiting: 0 };
      const placements: PlacementDto[] = (r?.placements ?? []).map((p) => ({
        entryId: p.entryId,
        place: p.place,
        medal: p.medal,
        wins: p.wins,
        losses: p.losses,
        publicName: p.entry.publicName,
        club: p.entry.snapClubName,
        region: p.entry.snapRegionName,
        withdrawn: p.entry.status === 'WITHDRAWN',
      }));
      return {
        categoryId: c.id,
        competitionId: c.competitionId,
        categoryName: { ru: c.nameRu, en: c.nameEn },
        categoryStatus: c.status,
        format: c.draws[0]?.format ?? null,
        // Сетку снова открыло изменение результата — итоги без мест не показываются, пока категория не завершится.
        status: r && r.placements.length > 0 ? r.status : null,
        computedAt: r && r.placements.length > 0 ? r.computedAt.toISOString() : null,
        publishedAt: r?.publishedAt?.toISOString() ?? null,
        publishedBy: r?.publishedBy ? { id: r.publishedBy.id, displayName: r.publishedBy.displayName } : null,
        amendedAt: r?.amendedAt?.toISOString() ?? null,
        version: r?.version ?? 0,
        matchesTotal: n.total,
        matchesDecided: n.decided,
        awaitingConfirmation: n.awaiting,
        placements,
        canPublish: mayPublish && c.status === 'COMPLETED' && !!r && r.placements.length > 0,
      };
    });
  }

  async competitionResults(user: AuthUser, competitionId: string): Promise<CompetitionResultsDto> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    await this.policy.assert(user, 'competition.view', scope);
    const categories = await this.categoryDtos(user, scope, { competitionId });
    const allPublished =
      categories.length > 0 && categories.every((c) => c.categoryStatus === 'RESULTS_PUBLISHED');
    return {
      competition: {
        id: competition.id,
        name: competition.name,
        status: competition.status,
        timezone: competition.timezone,
      },
      categories,
      allPublished,
      canFinish:
        allPublished &&
        competition.status === 'IN_PROGRESS' &&
        (await this.policy.can(user, 'competition.transition', scope)),
    };
  }

  async categoryResults(user: AuthUser, categoryId: string): Promise<CategoryResultsDto | null> {
    const category = await this.categories.require(categoryId);
    const scope = await this.competitions.scopeOf(category.competitionId);
    await this.policy.assert(user, 'competition.view', scope);
    const [dto] = await this.categoryDtos(user, scope, { id: categoryId });
    return dto ?? null;
  }

  /**
   * История спортсмена (вкладка «Результаты»): опубликованные места по турнирам, новые сверху; итоги — из
   * истории (схватки — победы и поражения, турниры — различные турниры, медали — по местам).
   */
  async history(user: AuthUser, athleteId: string): Promise<AthleteHistoryDto> {
    await this.athletes.assertView(user, athleteId);
    const rows = await this.db.athleteResult.findMany({
      where: { athleteId },
      orderBy: [{ competitionStartDate: 'desc' }, { publishedAt: 'desc' }],
    });
    const medals: Record<Medal, number> = { GOLD: 0, SILVER: 0, BRONZE: 0 };
    for (const r of rows) if (r.medal) medals[r.medal] += 1;
    const wins = rows.reduce((s, r) => s + r.wins, 0);
    const losses = rows.reduce((s, r) => s + r.losses, 0);
    return {
      athleteId,
      summary: {
        competitions: new Set(rows.map((r) => r.competitionId)).size,
        matches: wins + losses,
        wins,
        losses,
        medals,
      },
      results: rows.map((r) => ({
        competitionId: r.competitionId,
        competitionName: r.competitionName,
        startDate: r.competitionStartDate.toISOString().slice(0, 10),
        endDate: r.competitionEndDate.toISOString().slice(0, 10),
        level: r.competitionLevel,
        categoryName: { ru: r.categoryNameRu, en: r.categoryNameEn },
        clubName: r.clubName,
        place: r.place,
        medal: r.medal,
        wins: r.wins,
        losses: r.losses,
        status: r.status,
        publishedAt: r.publishedAt.toISOString(),
      })),
    };
  }
}
