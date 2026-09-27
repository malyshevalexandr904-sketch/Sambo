// Жеребьёвка в жизненном цикле турнира: область прав версии жеребьёвки и условие возврата турнира
// DRAWING → CHECK_IN — нет опубликованных жеребьёвок (ARCHITECTURE.md, 16.1).
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ScopeResolverRegistry } from '../../access';
import { CompetitionExtensions, CompetitionScopeService } from '../../competitions';

@Injectable()
export class DrawLifecycle implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly registry: ScopeResolverRegistry,
    private readonly competitions: CompetitionScopeService,
    private readonly extensions: CompetitionExtensions,
  ) {}

  onModuleInit(): void {
    this.registry.register('draw', async (id) => {
      const draw = id
        ? await this.db.draw.findUnique({ where: { id }, select: { competitionId: true } })
        : null;
      if (!draw) throw new DomainError('NOT_FOUND', { resource: 'draw' });
      return this.competitions.scopeOf(draw.competitionId);
    });
    this.extensions.registerCheck(async ({ tx, competition, from, to }) => {
      if (from !== 'DRAWING' || to !== 'CHECK_IN') return { blocking: [] };
      const published = await tx.draw.count({
        where: { competitionId: competition.id, status: 'PUBLISHED' },
      });
      return { blocking: published > 0 ? ['draws_published'] : [] };
    });
  }
}
