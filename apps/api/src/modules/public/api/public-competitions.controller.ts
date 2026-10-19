import { Controller, Get, Header } from '@nestjs/common';
import {
  type DataEnvelope,
  type Page,
  type PublicCompetition,
  type PublicCompetitionRatingSummary,
  PublicCompetitionsQuery,
  type PublicCompetitionSummary,
  type PublicRatedMatch,
  RatedMatchesQuery,
  Slug,
} from '@sde/contracts';
import { ok } from '../../../common/http/http';
import { RateLimit } from '../../../common/security/rate-limit';
import { ValidParam, ValidQuery } from '../../../common/validation/zod.pipe';
import { Public } from '../../access';
import { CompetitionRatingResultsService } from '../../rating';
import { PublicCompetitionsService } from '../application/public-competitions.service';

/** Кэш публичных ответов (API.md, 5.9): минута свежести, пять минут устаревшего ответа при обновлении. */
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

/** Публичный API только для чтения (раздел 58 ТЗ): без входа, отдельный префикс `/api/public/v1`. */
@Controller('api/public/v1/competitions')
@RateLimit('public')
export class PublicCompetitionsController {
  constructor(
    private readonly competitions: PublicCompetitionsService,
    private readonly rating: CompetitionRatingResultsService,
  ) {}

  @Get()
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  list(
    @ValidQuery(PublicCompetitionsQuery) q: PublicCompetitionsQuery,
  ): Promise<Page<PublicCompetitionSummary>> {
    return this.competitions.list(q);
  }

  @Get(':slug')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async get(@ValidParam('slug', Slug) slug: string): Promise<DataEnvelope<PublicCompetition>> {
    return ok(await this.competitions.get(slug));
  }

  /** Изменения рейтинга участников рейтингового турнира (ТЗ 45, 48), если турнир показывает их публично. */
  @Get(':slug/rating-summary')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  async ratingSummary(
    @ValidParam('slug', Slug) slug: string,
  ): Promise<DataEnvelope<PublicCompetitionRatingSummary>> {
    return ok(await this.rating.summary(slug));
  }

  /** Посчитанные схватки рейтингового турнира с рейтингом до и после, новые сверху. */
  @Get(':slug/rated-matches')
  @Public()
  @Header('Cache-Control', PUBLIC_CACHE)
  ratedMatches(
    @ValidParam('slug', Slug) slug: string,
    @ValidQuery(RatedMatchesQuery) q: RatedMatchesQuery,
  ): Promise<Page<PublicRatedMatch>> {
    return this.rating.matches(slug, q);
  }
}
