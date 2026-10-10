// Ручная схватка вне сетки (план Phase 7b, §4; `match.create`): два участника категории, подпись круга,
// длительность, ковёр и сессия (в конец ковра). Проводится на планшете как обычная, на места не влияет;
// отменить её можно (`match.cancel`), в отличие от схватки сетки.
import { Injectable } from '@nestjs/common';
import type { CategoryStatus, ManualMatchCreate, MatchDetailDto } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { CategoryWorkflowService } from '../../categories';
import { CompetitionScopeService } from '../../competitions';
import { MatchesService } from '../../matches';
import { ScheduleAppendService } from '../../scheduling';
import { MatchQueriesService } from './match-queries.service';

const blocked = (...failed: string[]): DomainError =>
  new DomainError('TRANSITION_PRECONDITIONS_NOT_MET', { failed });

/** Категория с сеткой: в ней проводятся схватки (в том числе после итогов — показательные, переигровки). */
const OPEN_CATEGORY: readonly CategoryStatus[] = ['DRAWN', 'IN_PROGRESS', 'COMPLETED', 'RESULTS_PUBLISHED'];

@Injectable()
export class ManualMatchesService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly competitions: CompetitionScopeService,
    private readonly categories: CategoryWorkflowService,
    private readonly matches: MatchesService,
    private readonly schedule: ScheduleAppendService,
    private readonly queries: MatchQueriesService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, categoryId: string, input: ManualMatchCreate): Promise<MatchDetailDto> {
    const category = await this.categories.require(categoryId);
    const scope = await this.competitions.scopeOf(category.competitionId);
    const access = await this.policy.assert(user, 'match.create', scope);
    const matchId = await this.db.tx(async (tx) => {
      const locked = await this.categories.lockForCommand(tx, categoryId);
      if (locked.competitionStatus !== 'SCHEDULED' && locked.competitionStatus !== 'IN_PROGRESS')
        throw blocked('competition_status');
      if (!OPEN_CATEGORY.includes(locked.category.status)) throw blocked('category_status');
      const entries = await tx.entry.findMany({
        where: { id: { in: [input.redEntryId, input.blueEntryId] } },
        select: { id: true, categoryId: true, status: true },
      });
      if (entries.length !== 2 || entries.some((e) => e.categoryId !== categoryId))
        throw blocked('participant_not_in_category');
      if (entries.some((e) => e.status !== 'APPROVED')) throw blocked('participant_withdrawn');
      const m = await this.matches.createManual(tx, {
        competitionId: category.competitionId,
        categoryId,
        label: input.label,
        durationSeconds: input.durationSeconds,
        redEntryId: input.redEntryId,
        blueEntryId: input.blueEntryId,
      });
      const slot = await this.schedule.append(tx, {
        competitionId: category.competitionId,
        matchId: m.id,
        sessionId: input.sessionId,
        matId: input.matId,
      });
      await this.audit.record(tx, {
        action: 'match.created',
        entityType: 'Match',
        entityId: m.id,
        competitionId: category.competitionId,
        after: {
          number: m.matchNumber,
          label: input.label,
          red: input.redEntryId,
          blue: input.blueEntryId,
          matId: input.matId,
          plannedAt: slot.plannedAt.toISOString(),
        },
        reason: input.reason ?? null,
        platformIntervention: access.viaPlatform,
      });
      return m.id;
    });
    return this.queries.detail(user, matchId);
  }
}
