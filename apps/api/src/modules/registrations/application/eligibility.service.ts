// Совместимость спортсмена с категориями турнира (API.md, 5.3; ADR-02): единственное место расчёта —
// и для подсказки в интерфейсе (`eligible-categories`), и для проверки при заявке и переводе.
import { Injectable } from '@nestjs/common';
import type {
  EligibilityReason,
  EligibleCategoriesDto,
  EligibleCategoriesQuery,
  EligibleCategory,
} from '@sde/contracts';
import { publicName } from '@sde/contracts';
import type { Tx } from '@sde/db';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AthleteAccessService, type AthleteRegistrationInfo } from '../../athletes';
import {
  CompetitionCategoriesService,
  type CompetitionCategorySpec,
  CompetitionRulesService,
  type EligibilityResult,
  resolveEligibleCategories,
} from '../../categories';
import { type CompetitionBasics, CompetitionScopeService } from '../../competitions';
import { OrganizationScopeService } from '../../organizations';
import { ACTIVE_ENTRY_STATUSES } from '../domain/entry-rules';

export interface EligibilityOptions {
  declaredWeightGrams?: number | null;
  /** Участие, которое переводят в другую категорию: не считается в лимите и в «уже заявлен». */
  excludeEntryId?: string;
  /** Перевод после закрытия регистрации: статус категории не проверяется (проверяет команда перевода). */
  ignoreCategoryStatus?: boolean;
}

export interface Evaluation {
  eligible: { category: CompetitionCategorySpec; weightMatch: boolean | null }[];
  ineligible: { category: CompetitionCategorySpec; reasons: EligibilityReason[] }[];
  existingEntries: number;
}

const toItem = (c: CompetitionCategorySpec, weightMatch: boolean | null): EligibleCategory => ({
  id: c.id,
  code: c.code,
  name: c.name,
  gender: c.gender,
  weight: c.weight,
  weightMatch,
});

@Injectable()
export class EligibilityService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly athletes: AthleteAccessService,
    private readonly categories: CompetitionCategoriesService,
    private readonly rules: CompetitionRulesService,
    private readonly competitions: CompetitionScopeService,
    private readonly orgScopes: OrganizationScopeService,
  ) {}

  async evaluate(
    tx: Tx | null,
    competition: CompetitionBasics,
    athlete: AthleteRegistrationInfo,
    opts: EligibilityOptions = {},
  ): Promise<Evaluation> {
    const client = tx ?? this.db;
    const [specs, rules, ranks, entries] = await Promise.all([
      this.categories.specs(competition.id, tx ?? undefined),
      this.rules.ruleSpecs(competition.id, tx ?? undefined),
      client.sportRank.findMany({ select: { code: true, rankOrder: true } }),
      client.entry.findMany({
        where: {
          competitionId: competition.id,
          athleteId: athlete.athleteId,
          status: { in: [...ACTIVE_ENTRY_STATUSES] },
          id: opts.excludeEntryId ? { not: opts.excludeEntryId } : undefined,
        },
        select: { categoryId: true },
      }),
    ]);
    const primaryClub = athlete.memberships.find((m) => m.isPrimary) ?? athlete.memberships[0];
    const result: EligibilityResult<CompetitionCategorySpec> = resolveEligibleCategories(
      {
        birthDate: athlete.birthDate,
        gender: athlete.gender,
        rankCode: athlete.rankCode,
        regionId: athlete.personRegionId ?? primaryClub?.regionId ?? null,
        declaredWeightGrams: opts.declaredWeightGrams ?? null,
      },
      specs,
      rules,
      {
        competitionStartDate: competition.startDate,
        rankOrder: new Map(ranks.map((r) => [r.code, r.rankOrder])),
        existingEntries: entries.length,
      },
    );
    const entered = new Set(entries.map((e) => e.categoryId));
    const extra = (c: CompetitionCategorySpec): EligibilityReason[] => [
      ...(!opts.ignoreCategoryStatus && c.status !== 'REGISTRATION' ? (['CATEGORY_CLOSED'] as const) : []),
      ...(entered.has(c.id) ? (['ALREADY_ENTERED'] as const) : []),
    ];
    const out: Evaluation = { eligible: [], ineligible: [], existingEntries: entries.length };
    for (const e of result.eligible) {
      const reasons = extra(e.category);
      if (reasons.length > 0) out.ineligible.push({ category: e.category, reasons });
      else out.eligible.push(e);
    }
    for (const i of result.ineligible)
      out.ineligible.push({
        category: i.category,
        reasons: [...new Set([...i.reasons, ...extra(i.category)])],
      });
    return out;
  }

  /**
   * Подсказка для заявки: тренер или руководитель клуба спортсмена (`registration.create` в его организации)
   * либо секретариат турнира (`registration.view`). Остальным спортсмен не виден (404).
   */
  async eligibleCategories(
    user: AuthUser,
    competitionId: string,
    q: EligibleCategoriesQuery,
  ): Promise<EligibleCategoriesDto> {
    const competition = await this.competitions.require(competitionId);
    const scope = await this.competitions.scopeFor(competition);
    if (competition.status === 'DRAFT') await this.policy.assert(user, 'competition.view', scope);
    const athlete = await this.athletes.registrationInfo(q.athleteId);
    if (!athlete) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    const orgScopes = await Promise.all(
      athlete.memberships.map((m) => this.orgScopes.scopeOf(m.organizationId)),
    );
    const allowed =
      (await this.policy.canAny(user, 'registration.create', orgScopes)) ||
      (await this.policy.can(user, 'registration.view', scope));
    if (!allowed) throw new DomainError('NOT_FOUND', { resource: 'athlete' });
    const r = await this.evaluate(null, competition, athlete, { declaredWeightGrams: q.declaredWeightGrams });
    return {
      athlete: {
        id: athlete.athleteId,
        publicName: publicName(athlete.lastName, athlete.firstName),
        birthDate: athlete.birthDate,
        gender: athlete.gender,
        rankCode: athlete.rankCode,
      },
      eligible: r.eligible.map((e) => toItem(e.category, e.weightMatch)),
      ineligible: r.ineligible.map((i) => ({ category: toItem(i.category, null), reasons: i.reasons })),
    };
  }
}
