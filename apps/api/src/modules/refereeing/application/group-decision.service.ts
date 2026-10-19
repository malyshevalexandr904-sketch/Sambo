// Решение общего места подгруппы рейтингового формата (ТЗ 31; `result.amend` — главный судья): критерии мест не
// разделили участников, от места которых зависит выход в финальную часть или пара в ней. Порядок задают люди, с
// причиной; решение только дополняется (действует последнее по подгруппе) и принимается лишь для ярусов, которые
// сейчас ждут решения. Дальше — как изменение результата: сетка пересчитывается (начатые зависимые схватки —
// DEPENDENT_MATCHES_STARTED), места категории — заново. Блокировки — категория → жеребьёвка.
import { Injectable } from '@nestjs/common';
import type { GroupPlaceDecisionDto, GroupPlaceDecisionInput } from '@sde/contracts';
import type { AuthUser } from '../../../common/context/request-context';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PolicyService } from '../../access';
import { AuditService } from '../../audit';
import { BracketsService } from '../../brackets';
import { CategoryWorkflowService } from '../../categories';
import { CategoryResultsService } from '../../results';
import { MatchContextService } from './match-context.service';
import { WithdrawalsService } from './withdrawals.service';

const sameMembers = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/** Каждый ярус решения — ровно один из ярусов, ждущих решения, и все они покрыты. */
const coversExactly = (expected: string[][], tiers: string[][]): boolean =>
  expected.length === tiers.length && expected.every((e) => tiers.some((t) => sameMembers(e, t)));

@Injectable()
export class GroupDecisionService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: PolicyService,
    private readonly context: MatchContextService,
    private readonly brackets: BracketsService,
    private readonly categories: CategoryWorkflowService,
    private readonly withdrawals: WithdrawalsService,
    private readonly results: CategoryResultsService,
    private readonly audit: AuditService,
  ) {}

  async decide(
    user: AuthUser,
    drawId: string,
    input: GroupPlaceDecisionInput,
  ): Promise<GroupPlaceDecisionDto> {
    const { group } = input;
    const draw = await this.db.draw.findUnique({
      where: { id: drawId },
      select: { competitionId: true, categoryId: true, status: true },
    });
    if (!draw) throw new DomainError('NOT_FOUND', { resource: 'draw' });
    const access = await this.policy.assert(
      user,
      'result.amend',
      await this.context.scopeOf(draw.competitionId),
    );
    const decidedAt = await this.db.tx(async (tx) => {
      const locked = await this.categories.lockForCommand(tx, draw.categoryId);
      if (!(await this.brackets.lockDraw(tx, drawId)))
        throw new DomainError('INVALID_TRANSITION', { from: draw.status, to: 'PUBLISHED', allowed: [] });
      const expected = (await this.brackets.undecidedTiers(tx, drawId, group)) ?? [];
      if (expected.length === 0 || !coversExactly(expected, input.tiers))
        throw new DomainError('GROUP_DECISION_MISMATCH', { group, expected });
      const row = await tx.groupPlaceDecision.create({
        data: {
          competitionId: draw.competitionId,
          drawId,
          groupLetter: group,
          tiers: input.tiers,
          reason: input.reason,
          decidedById: user.id,
        },
        select: { createdAt: true },
      });
      await this.brackets.propagateAfterAmend(tx, drawId);
      await this.withdrawals.resolve(tx, drawId);
      await this.results.refresh(tx, locked, drawId);
      await this.audit.record(tx, {
        action: 'bracket.group_places_decided',
        entityType: 'Draw',
        entityId: drawId,
        competitionId: draw.competitionId,
        before: { group, tiers: expected },
        after: { group, tiers: input.tiers },
        reason: input.reason,
        platformIntervention: access.viaPlatform,
      });
      return row.createdAt;
    });
    return { drawId, group, decidedAt: decidedAt.toISOString() };
  }
}
