import { Controller, Get, Header } from '@nestjs/common';
import {
  AthletePublicId,
  type DataEnvelope,
  type Page,
  type PublicAthleteRating,
  type PublicRankingRow,
  type PublicRatedCompetition,
  type PublicRatingChart,
  type PublicRatingHistoryItem,
  RankingsQuery,
  RatingHistoryQuery,
} from '@sde/contracts';
import { ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { Public } from '../../access';
import { RatingProfileService, RatingRankingsService } from '../../rating';

/** Кэш как у остальной витрины (API.md, 5.9): рейтинг меняется после схватки, минута задержки допустима. */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** Таблица рейтинга и рейтинг спортсмена (docs/RATING_ARCHITECTURE.md, 8; фаза 7): без входа. */
@Controller('api/public/v1')
@RateLimit('public')
export class PublicRankingsController {
  constructor(
    private readonly rankings: RatingRankingsService,
    private readonly profile: RatingProfileService,
  ) {}

  @Get('rankings')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  list(@ValidQuery(RankingsQuery) q: RankingsQuery): Promise<Page<PublicRankingRow>> {
    return this.rankings.list(q);
  }

  @Get('rankings/:publicId')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async card(
    @ValidParam('publicId', AthletePublicId) publicId: string,
  ): Promise<DataEnvelope<PublicAthleteRating>> {
    return ok(await this.rankings.card(publicId));
  }

  @Get('athletes/:publicId/rating-history')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  history(
    @ValidParam('publicId', AthletePublicId) publicId: string,
    @ValidQuery(RatingHistoryQuery) q: RatingHistoryQuery,
  ): Promise<Page<PublicRatingHistoryItem>> {
    return this.rankings.history(publicId, q);
  }

  /** Точки графика Elo (ТЗ 40): X — время, Y — рейтинг. */
  @Get('athletes/:publicId/rating-chart')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async chart(
    @ValidParam('publicId', AthletePublicId) publicId: string,
  ): Promise<DataEnvelope<PublicRatingChart>> {
    return ok(await this.profile.chart(publicId));
  }

  /** История рейтинговых турниров спортсмена (ТЗ 39). */
  @Get('athletes/:publicId/rated-competitions')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async competitions(
    @ValidParam('publicId', AthletePublicId) publicId: string,
  ): Promise<DataEnvelope<PublicRatedCompetition[]>> {
    return ok(await this.profile.competitions(publicId));
  }
}
