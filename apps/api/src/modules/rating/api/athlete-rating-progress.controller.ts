import { Controller, Get } from '@nestjs/common';
import type { AthleteRatingProgress, DataEnvelope } from '@sde/contracts';
import { CurrentUser } from '../../../common/context/current-user';
import type { AuthUser } from '../../../common/context/request-context';
import { ok } from '../../../common/http/http';
import { UuidParam } from '../../../common/validation/zod.pipe';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Authenticated } from '../../access';
import { AthleteAccessService } from '../../athletes';
import { DivisionsService } from '../../divisions';
import { RatingRankingsService } from '../application/rating-rankings.service';

/** Событий на трекере Elo — последние; многолетней истории этого достаточно. */
const PROGRESS_EVENTS = 500;

/**
 * Кабинет спортсмена (docs/RATED_ONLY.md, 4, 5): дивизион и трекер Elo от схватки к схватке. Видят те же, кто видит
 * карточку спортсмена: сам спортсмен, подтверждённый представитель, тренер и клуб.
 */
@Controller('athletes')
export class AthleteRatingProgressController {
  constructor(
    private readonly db: PrismaService,
    private readonly access: AthleteAccessService,
    private readonly divisions: DivisionsService,
    private readonly rankings: RatingRankingsService,
  ) {}

  @Get(':id/rating-progress')
  @Authenticated()
  async progress(
    @CurrentUser() user: AuthUser,
    @UuidParam('id') id: string,
  ): Promise<DataEnvelope<AthleteRatingProgress>> {
    await this.access.assertView(user, id);
    const athlete = await this.db.athleteProfile.findUniqueOrThrow({
      where: { id },
      select: { person: { select: { birthDate: true } } },
    });
    const [division, progress] = await Promise.all([
      this.divisions.forBirthDate(athlete.person.birthDate.toISOString().slice(0, 10)),
      this.rankings.progress(id, PROGRESS_EVENTS),
    ]);
    return ok({ ...progress, division });
  }
}
